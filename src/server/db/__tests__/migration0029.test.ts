import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

/**
 * 0029: export of one client's data (owner / admin, caller's RLS, audit with
 * counts only) and the data_subject_requests register. Real PostgreSQL (PGlite),
 * synthetic data only.
 */
const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OTHER_OWNER = "bbbbbbbb-0000-4000-8000-0000000000a2";
const ADMIN = "cccccccc-0000-4000-8000-0000000000a3";
const MANAGER = "dddddddd-0000-4000-8000-0000000000a4";
const STAFF = "eeeeeeee-0000-4000-8000-0000000000a5";
const ACCOUNTANT = "ffffffff-0000-4000-8000-0000000000a6";
const ACCOUNT_USER = "abababab-0000-4000-8000-0000000000a7";
const svc: Actor = { kind: "service" };
const user = (id: string): Actor => ({ kind: "user", id });

let db: PGlite;
let ws: string, otherWs: string, client: string, thirdParty: string, otherClient: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) =>
  as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const errOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: { message?: string }) => e.message ?? "error");
type Export = Record<string, unknown> & { meta: { counts: Record<string, number>; internalNotesIncluded: boolean } };
const exportAs = (actor: Actor, workspace: string, id: string, internal = false, mode = "admin", request: Record<string, unknown> | null = null) =>
  run<{ r: Export }>(actor, "select public.export_client_data($1,$2,$3,$4,$5::jsonb) as r", [workspace, id, internal, mode, request ? JSON.stringify(request) : null]).then((r) => r[0].r);
const snapshot = () =>
  q<{ s: string }>(`select md5(string_agg(t, '' order by t)) as s from (
     select to_jsonb(c)::text t from clients c union all select to_jsonb(a)::text from appointments a
     union all select to_jsonb(i)::text from invoices i union all select to_jsonb(w)::text from waiting_list w
     union all select to_jsonb(l)::text from leads l union all select to_jsonb(b)::text from booking_claims b) x`).then((r) => r[0].s);

let day = 3;
async function seed(workspace: string, name: string, email: string, withClaim = false) {
  const id = (await q<{ id: string }>("insert into clients (workspace_id,name,email,phone,notes) values ($1,$2,$3,'+49 30 555','prefers mornings') returning id", [workspace, name, email]))[0].id;
  const staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1 limit 1", [workspace]))[0].id;
  const svcId = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Haircut',30,40) returning id", [workspace]))[0].id;
  const bucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [workspace]))[0].id;
  const appt = (await q<{ id: string }>(
    `insert into appointments (workspace_id, client_id, service_id, staff_id, financial_bucket_id, status, starts_at, ends_at, timezone, client_notes, internal_notes, price)
     values ($1,$2,$3,$4,$5,'confirmed', now() + make_interval(days => $6), now() + make_interval(days => $6, mins => 30), 'Europe/Berlin', $7, $8, 40) returning id`,
    [workspace, id, svcId, staffId, bucket, day++, `${name} client note`, `${name} INTERNAL`],
  ))[0].id;
  if (withClaim) {
    await q("insert into booking_claims (appointment_id, token_hash, claimed_by, claimed_at, expires_at) values ($1,'SECRET_TOKEN_HASH',$2,now(),now() + interval '1 day')", [appt, ACCOUNT_USER]);
  }
  await q("insert into waiting_list (workspace_id, client_id, service_id, earliest_date, latest_date) values ($1,$2,$3,current_date + 1, current_date + 9)", [workspace, id, svcId]);
  await q("insert into leads (workspace_id, client_id, client_name, title, notes) values ($1,$2,$3,'Wedding',$4)", [workspace, id, name, `${name} lead note`]);
  await q("insert into invoices (workspace_id, client_id, client_name, number, status, financial_bucket_id) values ($1,$2,$3,$4,'draft',$5)", [workspace, id, name, `E-${id.slice(0, 6)}`, bucket]);
  return id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values
    ('${OWNER}','o@t.invalid'),('${OTHER_OWNER}','x@t.invalid'),('${ADMIN}','a@t.invalid'),
    ('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid'),('${ACCOUNT_USER}','u@t.invalid')`);
  const prov = async (u: string, e: string, slug: string) =>
    (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'Owner','Biz',$3,'en')", [u, e, slug]))[0].out_workspace_id;
  ws = await prov(OWNER, "o@t.invalid", "export-a");
  otherWs = await prov(OTHER_OWNER, "x@t.invalid", "export-b");
  await db.exec(`
    insert into profiles (id, email) values ('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid');
    insert into workspace_members (workspace_id, profile_id, role) values
      ('${ws}','${ADMIN}','admin'),('${ws}','${MANAGER}','manager'),('${ws}','${STAFF}','staff'),('${ws}','${ACCOUNTANT}','accountant');`);
  await q("update staff_profiles set name='Stylist Maria' where workspace_id=$1", [ws]);
  client = await seed(ws, "Anna Export", "anna@t.invalid", true);
  thirdParty = await seed(ws, "Bruno Third", "bruno@t.invalid");
  otherClient = await seed(otherWs, "Carla Other", "carla@t.invalid");
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("0029 client data export", () => {
  it("is idempotent as a migration", async () => {
    await db.exec(readFileSync(path.join(migrationsDir, "0029_client_data_export.sql"), "utf8"));
  });

  it("owner exports exactly one client: no third parties, staff names, tokens or internal notes", async () => {
    const data = await exportAs(user(OWNER), ws, client);
    const text = JSON.stringify(data);
    expect(text).toContain("Anna Export");
    expect(text).toContain("anna@t.invalid");
    expect(text).toContain("Anna Export client note");
    for (const forbidden of ["Bruno", "bruno@", "Carla", "INTERNAL", "Stylist Maria", "SECRET_TOKEN_HASH", ACCOUNT_USER]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
    expect(data.meta.internalNotesIncluded).toBe(false);
    expect(data.meta.counts).toMatchObject({ profile: 1, appointments: 1, invoices: 1, waitingList: 1, leads: 1 });
    expect(data.onlineAccount).toEqual({ linkedAppointments: 1 });
  });

  it("internal notes: only the owner may include them; the admin cannot", async () => {
    const owner = await exportAs(user(OWNER), ws, client, true);
    expect(JSON.stringify(owner)).toContain("Anna Export INTERNAL");
    expect(owner.meta.internalNotesIncluded).toBe(true);
    expect(await errOf(exportAs(user(ADMIN), ws, client, true))).toMatch(/client_export_internal_notes_not_permitted/);
  });

  it("admin may export; manager, staff, accountant, anon and other workspaces may not", async () => {
    expect(JSON.stringify(await exportAs(user(ADMIN), ws, client))).toContain("Anna Export");
    for (const id of [MANAGER, STAFF, ACCOUNTANT, OTHER_OWNER]) {
      expect(await errOf(exportAs(user(id), ws, client)), id).toMatch(/client_export_not_permitted/);
    }
    expect(await errOf(exportAs({ kind: "anon" }, ws, client))).toMatch(/permission denied/);
    expect(await errOf(run(user(MANAGER), "select public.client_export_account_link($1,$2)", [ws, client]))).toMatch(/client_export_not_permitted/);
  });

  it("a client of another workspace looks exactly like a missing one", async () => {
    expect(await errOf(exportAs(user(OWNER), ws, otherClient))).toMatch(/client_not_found/);
    expect(await errOf(exportAs(user(OWNER), ws, "00000000-0000-4000-8000-000000000000"))).toMatch(/client_not_found/);
    expect(await errOf(exportAs(user(OWNER), otherWs, otherClient))).toMatch(/client_export_not_permitted/);
  });

  it("does not change any data; the audit entry has categories and counts only", async () => {
    const before = await snapshot();
    await exportAs(user(OWNER), ws, client);
    await exportAs(user(OWNER), ws, client, false, "data_subject_request", { type: "portability", receivedOn: "2026-10-01", dueOn: "2026-10-31", identityVerified: true });
    expect(await snapshot()).toBe(before);
    const audit = await q<{ summary: string; actor_id: string; action: string }>(
      "select summary, actor_id, action from audit_logs where entity_id=$1 and action='exported' order by created_at desc limit 1", [client]);
    expect(audit[0]).toMatchObject({ actor_id: OWNER, action: "exported" });
    expect(audit[0].summary).toMatch(/^Client data export generated \(data_subject_request, internal notes excluded\): appointments 1/);
    for (const pii of ["Anna", "anna@", "+49", "client note", "lead note", "INTERNAL", "mornings"]) expect(audit[0].summary).not.toContain(pii);
  });

  it("rejects an unknown mode", async () => {
    expect(await errOf(exportAs(user(OWNER), ws, client, false, "everything"))).toMatch(/invalid_mode/);
  });
});

describe("0029 data_subject_requests", () => {
  let day = 0;
  /** A fresh request of `client`, status open. */
  const register = async (actor: Actor = user(OWNER), workspace = ws, id: string | null = client, type = "access") =>
    (await run<{ id: string }>(actor,
      `insert into data_subject_requests (workspace_id, client_id, request_type, received_on, due_on, identity_verified, created_by)
       values ($1, $2, $3, current_date - $4::int, current_date + 30, true, (select auth.uid())) returning id`, [workspace, id, type, day++]))[0].id;
  const generate = (requestId: string, actor: Actor = user(OWNER), workspace = ws, id = client) =>
    exportAs(actor, workspace, id, false, "data_subject_request", { requestId });
  const row = (id: string) => q<Record<string, unknown>>("select * from data_subject_requests where id=$1", [id]).then((r) => r[0]);
  const update = (id: string, set: string, actor: Actor = user(OWNER)) =>
    run(actor, `update data_subject_requests set ${set} where id=$1 returning id`, [id]);

  it("owner and admin register and read requests; other roles see nothing and cannot insert; no delete", async () => {
    const id = await register();
    await register(user(ADMIN));
    expect((await run(user(ADMIN), "select id from data_subject_requests where workspace_id=$1", [ws])).length).toBeGreaterThanOrEqual(2);
    for (const r of [MANAGER, STAFF, ACCOUNTANT, OTHER_OWNER]) {
      expect(await run(user(r), "select id from data_subject_requests"), r).toEqual([]);
      expect(await errOf(register(user(r))), r).toMatch(/row-level security/);
    }
    expect(await errOf(run(user(OWNER), "delete from data_subject_requests where id=$1", [id]))).toMatch(/permission denied/);
  });

  it("a generated file is not a delivery; handover is a separate recorded step; closing needs a reason", async () => {
    const id = await register();
    await update(id, "status='in_progress'");
    const first = await generate(id);
    expect(first.request).toMatchObject({ id, status: "export_generated", exportCount: 1 });
    expect(await row(id)).toMatchObject({ status: "export_generated", delivered_at: null, delivery_channel: null, export_count: 1 });

    expect(await errOf(update(id, "status='closed', closure_reason='fulfilled'"))).toMatch(/data_subject_request_not_delivered/);
    expect(await errOf(update(id, "status='delivered'"))).toMatch(/invalid_transition|delivery_chk/);
    await update(id, "status='delivered', delivered_at=now(), delivery_channel='post'");
    await update(id, "status='closed', closure_reason='fulfilled'");
    const closed = await row(id);
    expect(closed).toMatchObject({ status: "closed", closure_reason: "fulfilled", delivery_channel: "post" });
    expect(closed.closed_at).not.toBeNull();
  });

  it("a repeated export updates the same request: no duplicate, a recorded handover stays", async () => {
    const id = await register();
    await generate(id);
    await generate(id);
    expect(await row(id)).toMatchObject({ status: "export_generated", export_count: 2 });
    await update(id, "status='delivered', delivered_at=now(), delivery_channel='email'");
    await generate(id);
    expect(await row(id)).toMatchObject({ status: "delivered", export_count: 3, delivery_channel: "email" });
    // Without a request id: same client, type and date finds the open request.
    const details = { type: "erasure", receivedOn: "2026-09-01", dueOn: "2026-10-01", identityVerified: true };
    const a = await exportAs(user(OWNER), ws, client, false, "data_subject_request", details);
    const b = await exportAs(user(ADMIN), ws, client, false, "data_subject_request", details);
    expect((b.request as { id: string }).id).toBe((a.request as { id: string }).id);
    expect((b.request as { exportCount: number }).exportCount).toBe(2);
    expect((await q<{ n: number }>("select count(*)::int as n from data_subject_requests where client_id=$1 and request_type='erasure' and received_on='2026-09-01'", [client]))[0].n).toBe(1);
  });

  it("closing on other grounds works without a delivery; a closed request is final", async () => {
    const rejected = await register();
    await update(rejected, "status='closed', closure_reason='rejected'");
    const withdrawn = await register();
    await generate(withdrawn);
    await update(withdrawn, "status='closed', closure_reason='withdrawn'");
    const rectification = await register(user(OWNER), ws, client, "rectification");
    await update(rectification, "status='closed', closure_reason='fulfilled'"); // nothing to hand over
    expect(await errOf(update(rejected, "status='open', closure_reason=null"))).toMatch(/data_subject_request_closed/);
    expect(await errOf(generate(rejected))).toMatch(/request_not_found/);
    expect(await errOf(update(await register(), "status='closed'"))).toMatch(/closure_chk/);
  });

  it("the export step cannot be faked through the API", async () => {
    const id = await register();
    expect(await errOf(update(id, "status='export_generated'"))).toMatch(/invalid_transition/);
    expect(await errOf(update(id, "export_count=5"))).toMatch(/export_fields_protected/);
    expect(await errOf(update(id, "last_exported_at=now()"))).toMatch(/export_fields_protected/);
    expect(await errOf(update(id, "status='delivered', delivered_at=now(), delivery_channel='post'"))).toMatch(/invalid_transition/);
    expect(await errOf(run(user(OWNER),
      "insert into data_subject_requests (workspace_id, client_id, received_on, due_on, status, created_by) values ($1,$2,current_date,current_date+30,'export_generated',$3)",
      [ws, thirdParty, OWNER]))).toMatch(/invalid_state/);
    expect(await row(id)).toMatchObject({ status: "open", export_count: 0 });
  });

  it("identity must be confirmed before a file is generated for a request", async () => {
    const id = (await run<{ id: string }>(user(OWNER),
      "insert into data_subject_requests (workspace_id, client_id, request_type, received_on, due_on, created_by) values ($1,$2,'portability',current_date - 90,current_date,$3) returning id",
      [ws, client, OWNER]))[0].id;
    expect(await errOf(generate(id))).toMatch(/identity_not_verified/);
    expect(await errOf(exportAs(user(OWNER), ws, client, false, "data_subject_request", { type: "access", receivedOn: "2026-08-01", dueOn: "2026-09-01", identityVerified: false }))).toMatch(/identity_not_verified/);
    expect(await row(id)).toMatchObject({ status: "open", export_count: 0 });
    await update(id, "identity_verified=true");
    expect((await generate(id)).request).toMatchObject({ status: "export_generated" });
  });

  it("a failed audit entry rolls everything back: no request, no count, no status change", async () => {
    const id = await register();
    await db.exec(`create function public.test_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'forced_audit_failure'; end; $$;
      create trigger test_audit_fail before insert on public.audit_logs for each row execute function public.test_audit_fail();`);
    try {
      expect(await errOf(generate(id))).toMatch(/forced_audit_failure/);
      expect(await errOf(exportAs(user(OWNER), ws, client, false, "data_subject_request", { type: "objection", receivedOn: "2026-07-01", dueOn: "2026-08-01", identityVerified: true }))).toMatch(/forced_audit_failure/);
    } finally {
      await db.exec("drop trigger test_audit_fail on public.audit_logs; drop function public.test_audit_fail();");
    }
    expect(await row(id)).toMatchObject({ status: "open", export_count: 0, last_exported_at: null });
    expect((await q<{ n: number }>("select count(*)::int as n from data_subject_requests where request_type='objection'"))[0].n).toBe(0);
  });

  it("no request of another client or workspace can be touched; the register holds no exported content", async () => {
    const id = await register();
    expect(await errOf(generate(id, user(OWNER), ws, thirdParty))).toMatch(/request_not_found/);
    expect(await errOf(generate(id, user(OTHER_OWNER), otherWs, otherClient))).toMatch(/request_not_found/);
    expect(await errOf(generate(id, user(OTHER_OWNER), ws, client))).toMatch(/client_export_not_permitted/);
    expect(await update(id, "status='in_progress'", user(OTHER_OWNER))).toEqual([]);
    await generate(id);
    const text = JSON.stringify(await row(id));
    for (const pii of ["Anna", "anna@", "+49", "client note", "INTERNAL"]) expect(text).not.toContain(pii);
  });

  it("refuses a client or responsible person of another workspace and identity changes", async () => {
    expect(await errOf(register(user(OWNER), ws, otherClient))).toMatch(/cross_workspace_reference/);
    expect(await errOf(run(user(OWNER),
      "insert into data_subject_requests (workspace_id, client_id, received_on, due_on, responsible_profile_id, created_by) values ($1,$2,current_date - 200,current_date,$3,$4)",
      [ws, client, OTHER_OWNER, OWNER]))).toMatch(/cross_workspace_reference/);
    const id = await register();
    expect(await errOf(update(id, `client_id='${thirdParty}'`))).toMatch(/identity_immutable/);
  });

  it("security: functions pin search_path; EXECUTE not granted to PUBLIC / anon", async () => {
    const rows = await q<{ proname: string; config: string[] | null; anon_exec: boolean; auth_exec: boolean }>(
      `select p.proname, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('export_client_data','client_export_account_link','guard_data_subject_request')`);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.config).toContain('search_path=""');
      expect(r.anon_exec, r.proname).toBe(false);
    }
    expect(rows.find((r) => r.proname === "guard_data_subject_request")?.auth_exec).toBe(false);
  });
});
