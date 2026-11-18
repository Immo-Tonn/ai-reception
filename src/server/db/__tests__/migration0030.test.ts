import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";
import { createPgliteSupabaseClient } from "./supabasePglite";
import { createSupabaseRetentionStore, monthsBefore, RETENTION_POLICY, runRetentionChecks } from "@/server/retention/retention";

/**
 * 0030 retention dry run + the booking-claim cleanup of the daily cron.
 * Real PostgreSQL (PGlite), synthetic data only.
 */
const OWNER = "aaaaaaaa-0000-4000-8000-0000000000c1";
const OTHER_OWNER = "bbbbbbbb-0000-4000-8000-0000000000c2";
const ACCOUNT = "cccccccc-0000-4000-8000-0000000000c3";
const svc: Actor = { kind: "service" };

let db: PGlite;
let ws: string, otherWs: string, staff: string, otherStaff: string, service: string, otherService: string;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const errOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: { message?: string }) => e.message ?? "error");
const NOW = new Date();
const clientCutoff = monthsBefore(NOW, RETENTION_POLICY.clientMonths);
const inboxCutoff = monthsBefore(NOW, RETENTION_POLICY.inboxMonths);
const dryRun = () =>
  as(db, svc, async () => (await db.query<{ r: { clients: Record<string, unknown>; inboxEvents: Record<string, number> } }>(
    "select public.retention_dry_run($1,$2) as r", [clientCutoff.toISOString(), inboxCutoff.toISOString()])).rows[0].r);
const snapshot = () =>
  q<{ s: string }>(`select md5(string_agg(t, '' order by t)) as s from (
     select to_jsonb(c)::text t from clients c union all select to_jsonb(a)::text from appointments a
     union all select to_jsonb(e)::text from inbox_events e union all select to_jsonb(i)::text from invoices i) x`).then((r) => r[0].s);

let slot = 0;
/** Appointment `daysFromNow` days away (negative = past); distinct minutes avoid the staff overlap constraint. */
async function appt(workspace: string, client: string, daysFromNow: number, status: string) {
  const [st, sv] = workspace === ws ? [staff, service] : [otherStaff, otherService];
  return (await q<{ id: string }>(
    `insert into appointments (workspace_id, client_id, service_id, staff_id, status, starts_at, ends_at, timezone)
     values ($1,$2,$3,$4,$5::appointment_status, now() + make_interval(days => $6, mins => $7), now() + make_interval(days => $6, mins => $7 + 15), 'Europe/Berlin') returning id`,
    [workspace, client, sv, st, status, daysFromNow, (slot++) * 20],
  ))[0].id;
}
const newClient = async (workspace: string, name: string, createdDaysAgo = 2000) =>
  (await q<{ id: string }>("insert into clients (workspace_id,name,email,created_at) values ($1,$2,$3, now() - make_interval(days => $4)) returning id",
    [workspace, name, `${name.toLowerCase().replace(/\s/g, "")}@t.invalid`, createdDaysAgo]))[0].id;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${OTHER_OWNER}','x@t.invalid'),('${ACCOUNT}','u@t.invalid')`);
  const prov = async (u: string, e: string, slug: string) =>
    (await as(db, svc, async () => (await db.query<{ out_workspace_id: string }>("select * from public.provision_workspace($1,$2,'Owner','Biz',$3,'en')", [u, e, slug])).rows))[0].out_workspace_id;
  ws = await prov(OWNER, "o@t.invalid", "retention-a");
  otherWs = await prov(OTHER_OWNER, "x@t.invalid", "retention-b");
  staff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [ws]))[0].id;
  otherStaff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [otherWs]))[0].id;
  service = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes) values ($1,'Cut',15) returning id", [ws]))[0].id;
  otherService = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes) values ($1,'Cut',15) returning id", [otherWs]))[0].id;

  // Workspace A
  const candidate = await newClient(ws, "Old Visit");               // last completed visit 4 years ago -> candidate
  await appt(ws, candidate, -1500, "completed");
  const recent = await newClient(ws, "Recent Visit");               // completed visit 1 year ago -> not a candidate
  await appt(ws, recent, -1500, "completed");
  await appt(ws, recent, -365, "completed");
  const future = await newClient(ws, "Future Booking");             // old visit but a future appointment -> blocked
  await appt(ws, future, -1500, "completed");
  await appt(ws, future, 10, "confirmed");
  const open = await newClient(ws, "Open Status");                  // old visit, past appointment never closed -> blocked
  await appt(ws, open, -1500, "completed");
  await appt(ws, open, -1400, "pending");
  const invoiced = await newClient(ws, "Open Invoice");             // old visit, unpaid invoice -> blocked
  await appt(ws, invoiced, -1500, "completed");
  await q("insert into invoices (workspace_id, client_id, number, status) values ($1,$2,'R-1','sent')", [ws, invoiced]);
  const paid = await newClient(ws, "Paid Invoice");                 // paid invoice is NOT a blocker -> candidate
  await appt(ws, paid, -1500, "completed");
  // Test fixture only: a paid invoice needs items and payments; skip the write guard to create it directly.
  await q("set session_replication_role = replica");
  await q("insert into invoices (workspace_id, client_id, number, status) values ($1,$2,'R-2','paid')", [ws, paid]);
  await q("set session_replication_role = origin");
  const lead = await newClient(ws, "Open Lead");                    // open lead -> blocked
  await appt(ws, lead, -1500, "completed");
  await q("insert into leads (workspace_id, client_id, client_name, title) values ($1,$2,'Open Lead','Offer')", [ws, lead]);
  await newClient(ws, "Never Visited Old");                         // no completed visit, created 5+ years ago -> separate group
  await newClient(ws, "Never Visited New", 10);                     // no completed visit, new
  // Workspace B: one candidate; counted in the aggregate, never mixed with A's rows.
  const b = await newClient(otherWs, "B Old Visit");
  await appt(otherWs, b, -1500, "completed");

  // Inbox: 3 stale (one about an open appointment), 1 fresh.
  const openAppt = await appt(ws, future, 20, "confirmed");
  await q(`insert into inbox_events (workspace_id, type, code, title, created_at, is_read, entity_type, entity_id, dedupe_key) values
    ($1,'booking_created','booking.created','t', now() - interval '400 days', true, 'appointment', gen_random_uuid()::text, 'k1'),
    ($1,'booking_created','booking.created','t', now() - interval '400 days', false, 'appointment', gen_random_uuid()::text, 'k2'),
    ($1,'booking_created','booking.created','t', now() - interval '400 days', true, 'appointment', $2, 'k3'),
    ($1,'booking_created','booking.created','t', now() - interval '10 days', false, '', '', 'k4')`, [ws, openAppt]);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("0030 retention dry run", () => {
  it("is idempotent as a migration", async () => {
    await db.exec(readFileSync(path.join(migrationsDir, "0030_retention_dry_run.sql"), "utf8"));
  });

  it("counts candidates and blockers; clients without a completed visit are a separate group", async () => {
    const { clients } = await dryRun();
    expect(clients).toMatchObject({
      total: 10, // 9 in A, 1 in B
      candidates: 3, // Old Visit, Paid Invoice, B Old Visit
      recentVisit: 1,
      oldVisitButBlocked: 4, // future, open status, open invoice, open lead
      withoutCompletedVisitCreatedBeforeCutoff: 1,
      withoutCompletedVisitCreatedAfterCutoff: 1,
      alreadyAnonymized: 0,
      blockers: { futureAppointment: 1, openAppointmentStatus: 1, openInvoice: 1, openWorkItem: 1, activeWaitingList: 0 },
    });
  });

  it("counts stale notifications and keeps those about open processes apart", async () => {
    const { inboxEvents } = await dryRun();
    expect(inboxEvents).toEqual({ stale: 3, staleUnread: 1, staleForOpenProcess: 1, staleEligible: 2 });
  });

  it("changes nothing and returns no ids, names or contacts", async () => {
    const before = await snapshot();
    const result = JSON.stringify(await dryRun());
    expect(await snapshot()).toBe(before);
    expect(result).not.toMatch(/@t\.invalid|Old Visit|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("only the service role may run it; future cutoffs are refused", async () => {
    for (const actor of [{ kind: "anon" } as Actor, { kind: "user", id: OWNER } as Actor]) {
      expect(await errOf(as(db, actor, () => db.query("select public.retention_dry_run(now() - interval '1 year', now() - interval '1 year')")))).toMatch(/permission denied/);
    }
    expect(await errOf(as(db, svc, () => db.query("select public.retention_dry_run(now() + interval '1 day', now() - interval '1 year')")))).toMatch(/invalid_cutoff/);
    const [fn] = await q<{ config: string[] }>("select proconfig as config from pg_proc where proname='retention_dry_run'");
    expect(fn.config).toContain('search_path=""');
  });
});

describe("cron retention step: expired unclaimed booking claims", () => {
  it("deletes only expired, never-claimed claims older than the grace period of a finished appointment; repeat is a no-op", async () => {
    const c = await newClient(ws, "Claims Client");
    const ids = [
      await appt(ws, c, -100, "completed"), await appt(ws, c, -90, "completed"), await appt(ws, c, 5, "confirmed"), await appt(ws, c, -80, "completed"),
      await appt(ws, c, 7, "confirmed"), await appt(ws, c, -70, "pending"),
    ];
    await q(`insert into booking_claims (appointment_id, token_hash, claimed_by, claimed_at, expires_at) values
      ($1, md5('a'), null, null, now() - interval '60 days'),        -- expired long ago, unclaimed -> deleted
      ($2, md5('b'), $5, now() - interval '70 days', now() - interval '60 days'), -- claimed by an account -> kept
      ($3, md5('c'), null, null, now() + interval '2 days'),         -- still valid -> kept
      ($4, md5('d'), null, null, now() - interval '5 days'),         -- expired recently (grace) -> kept
      ($6, md5('e'), null, null, now() - interval '60 days'),        -- expired, unclaimed, but the appointment is upcoming -> kept
      ($7, md5('f'), null, null, now() - interval '60 days')         -- expired, unclaimed, past appointment never closed -> kept`,
      [ids[0], ids[1], ids[2], ids[3], ACCOUNT, ids[4], ids[5]]);
    const store = createSupabaseRetentionStore(createPgliteSupabaseClient(db, svc));
    const report = await runRetentionChecks({ store, env: {} });
    expect(report.bookingClaimsDeleted).toBe(1);
    expect(report.failedSteps).toEqual([]);
    const left = await q<{ appointment_id: string }>("select appointment_id from booking_claims where appointment_id = any($1::uuid[]) order by appointment_id", [ids]);
    expect(left.map((r) => r.appointment_id).sort()).toEqual([ids[1], ids[2], ids[3], ids[4], ids[5]].sort());
    expect((await runRetentionChecks({ store, env: {} })).bookingClaimsDeleted).toBe(0);
    // The appointments themselves are untouched.
    expect((await q("select count(*)::int as n from appointments where id = any($1::uuid[])", [ids]))[0].n).toBe(6);
  });
});
