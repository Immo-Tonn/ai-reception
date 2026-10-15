import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

/**
 * 0027: Inbox snapshot (details), initiator, dedupe per transaction, delete guard.
 * Real PostgreSQL (PGlite) with every migration; actors switch roles like Supabase.
 */
const OWNER = "aaaaaaaa-0000-4000-8000-0000000000e1";
const OTHER_OWNER = "bbbbbbbb-0000-4000-8000-0000000000e2";
const CLIENT = "cccccccc-0000-4000-8000-0000000000e3";
const svc: Actor = { kind: "service" };
const owner: Actor = { kind: "user", id: OWNER };

let db: PGlite;
let ws: string, otherWs: string, staff: string, service: string, client: string, bucket: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) => as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const codeOf = async (p: Promise<unknown>) => p.then(() => undefined, (e: { code?: string; message?: string }) => e.message ?? e.code ?? "error");
type Ev = { code: string; details: Record<string, unknown>; preview: string; actor_id: string | null };
const events = (apptId: string) => q<Ev>("select code, details, preview, actor_id from inbox_events where entity_id=$1 order by created_at, id", [apptId]);

async function newAppointment(actor: Actor, inDays: number, hhmm: string, extra: Record<string, unknown> = {}) {
  const cols = { workspace_id: ws, client_id: client, service_id: service, staff_id: staff, financial_bucket_id: bucket, status: "confirmed", ...(actor.kind === "user" ? { created_by: actor.id } : {}), ...extra };
  const keys = Object.keys(cols);
  const vals = Object.values(cols);
  const sql = `insert into appointments (${keys.join(",")}, starts_at, ends_at, timezone)
    values (${keys.map((_, i) => `$${i + 1}`).join(",")},
      ((now() at time zone 'Europe/Berlin')::date + ${inDays} + '${hhmm}'::time) at time zone 'Europe/Berlin',
      ((now() at time zone 'Europe/Berlin')::date + ${inDays} + '${hhmm}'::time + interval '45 minutes') at time zone 'Europe/Berlin',
      'Europe/Berlin') returning id`;
  return (await run<{ id: string }>(actor, sql, vals))[0].id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${OTHER_OWNER}','x@t.invalid'),('${CLIENT}','c@t.invalid')`);
  const prov = async (u: string, e: string, slug: string) =>
    (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'Maria Owner','Biz',$3,'en')", [u, e, slug]))[0].out_workspace_id;
  ws = await prov(OWNER, "o@t.invalid", "snap-a");
  otherWs = await prov(OTHER_OWNER, "x@t.invalid", "snap-b");
  await q("update profiles set full_name='Maria Owner' where id=$1", [OWNER]);
  staff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [ws]))[0].id;
  await q("update staff_profiles set name='Maria' where id=$1", [staff]);
  service = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Manicure',45,30) returning id", [ws]))[0].id;
  client = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Anna Ivanova','anna@t.invalid') returning id", [ws]))[0].id;
  bucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [ws]))[0].id;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("0027 inbox snapshot", () => {
  it("is idempotent", async () => {
    await db.exec(readFileSync(path.join(migrationsDir, "0027_inbox_snapshot_and_delete_guard.sql"), "utf8"));
  });

  it("a business user's booking: full snapshot, initiator business_user with role and name", async () => {
    const id = await newAppointment(owner, 3, "10:00");
    const [ev] = await events(id);
    expect(ev.code).toBe("booking.created");
    expect(ev.actor_id).toBe(OWNER);
    expect(ev.details).toMatchObject({
      v: 1,
      private: false,
      client_name: "Anna Ivanova",
      service: "Manicure",
      staff_name: "Maria",
      duration_minutes: 45,
      timezone: "Europe/Berlin",
      status: "confirmed",
      initiator: { kind: "business_user", role: "owner", name: "Maria Owner" },
    });
    expect(ev.details.old_starts_at).toBeUndefined();
  });

  it("reschedule keeps BOTH times; A -> B -> A -> B creates three events (dedupe per transaction)", async () => {
    const id = await newAppointment(owner, 4, "10:00");
    const [{ a }] = await q<{ a: string }>("select starts_at::text as a from appointments where id=$1", [id]);
    for (const shift of ["+ interval '1 day 4 hours'", "- interval '1 day 4 hours'", "+ interval '1 day 4 hours'"]) {
      await run(owner, `update appointments set starts_at = starts_at ${shift}, ends_at = ends_at ${shift} where id=$1`, [id]);
    }
    const moves = (await events(id)).filter((e) => e.code === "booking.rescheduled");
    expect(moves).toHaveLength(3);
    expect(new Date(moves[0].details.old_starts_at as string).getTime()).toBe(new Date(a).getTime());
    expect(new Date(moves[1].details.starts_at as string).getTime()).toBe(new Date(a).getTime());
    expect(moves[0].details.old_starts_at).not.toBe(moves[0].details.starts_at);
  });

  it("status change records old and new status", async () => {
    const id = await newAppointment(owner, 5, "11:00", { status: "pending" });
    await run(owner, "update appointments set status='confirmed' where id=$1", [id]);
    const ev = (await events(id)).find((e) => e.code === "booking.confirmed")!;
    expect(ev.details).toMatchObject({ old_status: "pending", status: "confirmed" });
  });

  it("guest online booking and client-account cancellation are 'client_online'", async () => {
    const [{ out_appointment_id: id }] = await run<{ out_appointment_id: string }>(
      svc,
      "select * from public.create_public_booking($1,$2,$3,null,((now() at time zone 'Europe/Berlin')::date + 6 + time '12:00') at time zone 'Europe/Berlin','Guest Person','guest@t.invalid','','')",
      [ws, service, staff],
    );
    const created = (await events(id))[0];
    expect(created.details.initiator).toEqual({ kind: "client_online" });
    expect(created.actor_id).toBeNull();

    // The client claims the booking into their account and cancels it from "My bookings".
    const [{ issue_booking_claim: token }] = await run<{ issue_booking_claim: string }>(svc, "select public.issue_booking_claim($1)", [id]);
    await run(svc, "select public.claim_booking($1,$2)", [CLIENT, token]);
    await run(svc, "select * from public.cancel_my_booking($1,$2)", [CLIENT, id]);
    const cancelled = (await events(id)).find((e) => e.code === "booking.cancelled")!;
    expect(cancelled.details).toMatchObject({ status: "cancelled", initiator: { kind: "client_online" } });
  });

  it("private appointments: no client or service in the snapshot (times and staff only)", async () => {
    const id = await newAppointment(owner, 7, "09:00", { visibility: "private" });
    const [ev] = await events(id);
    expect(ev.details.private).toBe(true);
    expect(ev.details.client_name).toBeUndefined();
    expect(ev.details.service).toBeUndefined();
    expect(ev.details.client_id).toBeUndefined();
    expect(ev.preview).toBe("");
    expect(ev.details.staff_name).toBe("Maria");
  });

  it("an explicit actor_kind (future automation) wins over the inference", async () => {
    const id = await newAppointment(svc, 8, "09:00");
    await db.exec("begin");
    await db.exec("select set_config('serviceos.actor_kind','system', true)");
    await db.query("update appointments set status='cancelled' where id=$1", [id]);
    await db.exec("commit");
    const ev = (await events(id)).find((e) => e.code === "booking.cancelled")!;
    expect(ev.details.initiator).toEqual({ kind: "system" });
  });

  it("another business never sees these events (RLS unchanged)", async () => {
    expect(await run(owner, "select count(*)::int as n from inbox_events where workspace_id=$1", [ws]).then((r) => (r[0] as { n: number }).n)).toBeGreaterThan(0);
    expect(await run({ kind: "user", id: OTHER_OWNER }, "select count(*)::int as n from inbox_events where workspace_id=$1", [ws]).then((r) => (r[0] as { n: number }).n)).toBe(0);
  });
});

describe("0027 delete guard", () => {
  it("a mistaken business-created appointment can be deleted", async () => {
    const id = await newAppointment(owner, 9, "10:00");
    await run(owner, "delete from appointments where id=$1", [id]);
    expect(await q("select 1 from appointments where id=$1", [id])).toHaveLength(0);
  });

  it("refuses: real outcome, online booking, invoice link", async () => {
    const done = await newAppointment(svc, -1, "10:00", { status: "completed" });
    expect(await codeOf(run(owner, "delete from appointments where id=$1", [done]))).toMatch(/appointment_has_history/);
    const noShow = await newAppointment(svc, -2, "10:00", { status: "no_show" });
    expect(await codeOf(run(owner, "delete from appointments where id=$1", [noShow]))).toMatch(/appointment_has_history/);
    const online = await newAppointment(svc, 10, "10:00", { source: "public" });
    expect(await codeOf(run(owner, "delete from appointments where id=$1", [online]))).toMatch(/appointment_is_online_booking/);
    const invoiced = await newAppointment(owner, 11, "10:00");
    await q("insert into invoices (workspace_id, client_id, appointment_id, financial_bucket_id, number, amount, currency, status) values ($1,$2,$3,$4,'T-1',30,'EUR','draft')", [ws, client, invoiced, bucket]).catch(async () => {
      // Column set of invoices differs between migrations; fall back to the minimal insert.
      await q("insert into invoices (workspace_id, appointment_id, financial_bucket_id) values ($1,$2,$3)", [ws, invoiced, bucket]);
    });
    expect(await codeOf(run(owner, "delete from appointments where id=$1", [invoiced]))).toMatch(/appointment_has_links/);
  });

  it("deleting a whole workspace still cascades (guard skips cascades)", async () => {
    await newAppointment(svc, -3, "10:00", { status: "completed" });
    await q("delete from workspaces where id=$1", [ws]);
    expect(await q("select 1 from appointments where workspace_id=$1", [ws])).toHaveLength(0);
    expect(otherWs).toBeTruthy();
  });
});
