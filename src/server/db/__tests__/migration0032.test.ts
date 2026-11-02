import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

/**
 * 0032: clients.archived_at — owner / admin only (trigger, also against direct
 * API updates), archiving changes nothing else, no new business booking for an
 * archived client (public booking path still works), an anonymised client is
 * never restored. PGlite, synthetic data.
 */
const OWNER = "aaaaaaaa-0000-4000-8000-0000000000f1";
const OTHER_OWNER = "bbbbbbbb-0000-4000-8000-0000000000f2";
const ADMIN = "cccccccc-0000-4000-8000-0000000000f3";
const MANAGER = "dddddddd-0000-4000-8000-0000000000f4";
const STAFF = "eeeeeeee-0000-4000-8000-0000000000f5";
const ACCOUNTANT = "ffffffff-0000-4000-8000-0000000000f6";
const svc: Actor = { kind: "service" };
const user = (id: string): Actor => ({ kind: "user", id });

let db: PGlite;
let ws: string, otherWs: string, staff: string, service: string, bucket: string;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) =>
  as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const errOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: { message?: string }) => e.message ?? "error");
const archivedAt = async (id: string) => (await q<{ a: string | null }>("select archived_at as a from clients where id=$1", [id]))[0].a;
const setArchived = (actor: Actor, id: string, on: boolean) =>
  run<{ id: string }>(actor, `update clients set archived_at = ${on ? "now()" : "null"} where id = $1 returning id`, [id]);

let day = 3;
async function appointment(actor: Actor, client: string, status = "confirmed") {
  const sql = `insert into appointments (workspace_id, client_id, service_id, staff_id, financial_bucket_id, status, starts_at, ends_at, timezone, created_by)
    values ($1,$2,$3,$4,$5,$6::appointment_status, now() + make_interval(days => $7), now() + make_interval(days => $7, mins => 30), 'Europe/Berlin', $8) returning id`;
  return (await run<{ id: string }>(actor, sql, [ws, client, service, staff, bucket, status, day++, actor.kind === "user" ? actor.id : null]))[0].id;
}
const newClient = async (workspace: string, name: string) =>
  (await q<{ id: string }>("insert into clients (workspace_id,name,email,phone,notes) values ($1,$2,$3,'+49 30 1','note') returning id", [workspace, name, `${name.toLowerCase()}@t.invalid`]))[0].id;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values
    ('${OWNER}','o@t.invalid'),('${OTHER_OWNER}','x@t.invalid'),('${ADMIN}','a@t.invalid'),
    ('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid')`);
  const prov = async (u: string, e: string, slug: string) =>
    (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'Owner','Biz',$3,'en')", [u, e, slug]))[0].out_workspace_id;
  ws = await prov(OWNER, "o@t.invalid", "archive-a");
  otherWs = await prov(OTHER_OWNER, "x@t.invalid", "archive-b");
  await db.exec(`
    insert into profiles (id, email) values ('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid');
    insert into workspace_members (workspace_id, profile_id, role) values
      ('${ws}','${ADMIN}','admin'),('${ws}','${MANAGER}','manager'),('${ws}','${STAFF}','staff'),('${ws}','${ACCOUNTANT}','accountant');`);
  staff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [ws]))[0].id;
  service = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Cut',30,40) returning id", [ws]))[0].id;
  bucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [ws]))[0].id;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("0032 client archiving", () => {
  it("is idempotent as a migration; owner and admin hold clients.archive", async () => {
    await db.exec(readFileSync(path.join(migrationsDir, "0032_client_archiving.sql"), "utf8"));
    const roles = await q<{ role: string }>("select role::text from role_permissions where permission='clients.archive' order by role");
    expect(roles.map((r) => r.role).sort()).toEqual(["admin", "owner"]);
  });

  it("owner and admin archive and restore", async () => {
    const c = await newClient(ws, "Owen");
    await setArchived(user(OWNER), c, true);
    expect(await archivedAt(c)).not.toBeNull();
    await setArchived(user(OWNER), c, false);
    expect(await archivedAt(c)).toBeNull();
    await setArchived(user(ADMIN), c, true);
    expect(await archivedAt(c)).not.toBeNull();
    await setArchived(user(ADMIN), c, false);
    expect(await archivedAt(c)).toBeNull();
  });

  it("manager, staff, accountant and another workspace cannot change the archive status (also directly)", async () => {
    const c = await newClient(ws, "Mia");
    expect(await errOf(setArchived(user(MANAGER), c, true))).toMatch(/client_archive_not_permitted/);
    for (const id of [STAFF, ACCOUNTANT, OTHER_OWNER]) {
      expect(await setArchived(user(id), c, true), id).toEqual([]); // RLS: the row is not even visible for update
    }
    expect(await archivedAt(c)).toBeNull();
    // The manager may still edit the client otherwise (no regression of clients.edit).
    await run(user(MANAGER), "update clients set notes='updated' where id=$1", [c]);
  });

  it("archiving changes nothing but archived_at: appointments (also future), statuses and invoices stay", async () => {
    const c = await newClient(ws, "Ada");
    const future = await appointment(user(OWNER), c, "confirmed");
    await q("insert into invoices (workspace_id, client_id, client_name, number, status) values ($1,$2,'Ada','A-1','draft')", [ws, c]);
    const snap = () => q<{ s: string }>(`select md5(string_agg(t, '' order by t)) as s from (
        select (to_jsonb(cl) - 'archived_at' - 'updated_at')::text t from clients cl where cl.id = $1
        union all select to_jsonb(a)::text from appointments a where a.client_id = $1
        union all select to_jsonb(i)::text from invoices i where i.client_id = $1) x`, [c]).then((r) => r[0].s);
    const before = await snap();
    await setArchived(user(OWNER), c, true);
    expect(await snap()).toBe(before);
    expect((await q<{ status: string }>("select status::text from appointments where id=$1", [future]))[0].status).toBe("confirmed");
  });

  it("no new business appointment or waiting-list entry for an archived client; the public/service path still books", async () => {
    const c = await newClient(ws, "Ben");
    await setArchived(user(OWNER), c, true);
    expect(await errOf(appointment(user(OWNER), c))).toMatch(/client_archived/);
    expect(await errOf(run(user(OWNER), "insert into waiting_list (workspace_id, client_id, service_id, earliest_date, latest_date) values ($1,$2,$3,current_date+1,current_date+5)", [ws, c, service]))).toMatch(/client_archived/);
    expect(await errOf(appointment(svc, c))).toBe("ok"); // e.g. a returning customer's online booking
    expect(await archivedAt(c)).not.toBeNull(); // no hidden status change
  });

  it("public online booking by an archived client still works (same client record, stays archived)", async () => {
    const c = await newClient(ws, "Paula");
    await setArchived(user(OWNER), c, true);
    const [{ starts }] = await q<{ starts: string }>(
      `select (((now() at time zone 'Europe/Berlin')::date + ((8 - extract(isodow from (now() at time zone 'Europe/Berlin'))::int) % 7 + 7)
        + time '10:00') at time zone 'Europe/Berlin')::text as starts`); // a Monday 10:00 Berlin, 1-2 weeks ahead
    const [booking] = await run<{ out_client_id: string; out_status: string }>(svc,
      "select * from public.create_public_booking($1,$2,$3,null,$4::timestamptz,'Paula','paula@t.invalid','+49 30 1','')",
      [ws, service, staff, starts]);
    expect(booking.out_client_id).toBe(c); // matched the existing (archived) client, no duplicate
    expect(await archivedAt(c)).not.toBeNull(); // no automatic restore
    expect((await q<{ n: number }>("select count(*)::int as n from clients where workspace_id=$1 and lower(email)='paula@t.invalid'", [ws]))[0].n).toBe(1);
  });

  it("an anonymised client (0028 marker) can be archived but never restored", async () => {
    const c = await newClient(ws, "Ana");
    const [{ has0028 }] = await q<{ has0028: boolean }>("select to_regprocedure('public.anonymize_client_core(uuid,uuid,uuid)') is not null as has0028");
    if (has0028) {
      await q("select public.anonymize_client_core($1,$2,null)", [ws, c]); // the real 0028 path
    } else {
      // This branch alone: simulate 0028's marker column.
      await q("alter table clients add column if not exists anonymized_at timestamptz");
      await q("update clients set anonymized_at = now() where id=$1", [c]);
    }
    await setArchived(user(OWNER), c, true);
    expect(await errOf(setArchived(user(OWNER), c, false))).toMatch(/client_anonymized/);
    expect(await archivedAt(c)).not.toBeNull();
  });

  it("security: trigger functions pin search_path and are not executable by API roles", async () => {
    const rows = await q<{ proname: string; config: string[]; auth_exec: boolean }>(
      `select proname, proconfig as config, has_function_privilege('authenticated', oid, 'execute') as auth_exec
         from pg_proc where proname in ('guard_client_archive','guard_no_archived_client_ref')`);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.config).toContain('search_path=""');
      expect(r.auth_exec).toBe(false);
    }
  });
});
