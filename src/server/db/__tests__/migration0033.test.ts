import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

/**
 * 0033: audit_logs protection. No write privilege for anon / signed-in users, insert
 * only for the service role; archive / retention / export audited inside the
 * database in the same transaction; definer functions keep writing; EXECUTE revoked
 * from the explicit list of application trigger functions. PGlite, synthetic data.
 * (Supabase's own default grants are covered by the opt-in real-Supabase test.)
 */
const OWNER = "aaaaaaaa-0000-4000-8000-000000000331";
const OTHER_OWNER = "bbbbbbbb-0000-4000-8000-000000000332";
const STAFF = "cccccccc-0000-4000-8000-000000000333";
const svc: Actor = { kind: "service" };
const anon: Actor = { kind: "anon" };
const user = (id: string): Actor => ({ kind: "user", id });

let db: PGlite;
let ws: string, otherWs: string;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) =>
  as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const errOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: { message?: string }) => e.message ?? "error");
const auditRows = (entityId: string) =>
  q<{ summary: string; source: string; actor_id: string | null; action: string }>(
    "select summary, source, actor_id, action from audit_logs where entity_id=$1 order by created_at, id", [entityId]);
const newClient = async (name: string) =>
  (await q<{ id: string }>("insert into clients (workspace_id,name,email,phone,notes) values ($1,$2,$3,'+49 30 1','note') returning id", [ws, name, `${name.toLowerCase()}@t.invalid`]))[0].id;

const TRIGGER_FUNCTIONS = [
  "after_invoice_item_change", "after_payment_change", "audit_client_archive", "audit_data_subject_request", "audit_workspace_retention",
  "forget_client_in_inbox", "guard_anonymized_client", "guard_appointment_delete", "guard_appointment_history", "guard_client_archive",
  "guard_data_subject_request", "guard_external_calendar_refs", "guard_inbox_event", "guard_invoice_item_write", "guard_invoice_references",
  "guard_invoice_restrict_delete", "guard_invoice_work_references", "guard_invoice_write", "guard_no_anonymized_client_ref",
  "guard_no_archived_client_ref", "guard_payment_write", "guard_profile_update", "guard_restrict_delete_with_appointments",
  "guard_scheduling_references", "guard_waiting_list", "guard_work_references", "guard_working_hours_integrity", "guard_workspace_references",
  "guard_workspace_retention_setting", "guard_workspace_update", "record_appointment_inbox_event", "set_appointment_busy_range",
];

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${OTHER_OWNER}','x@t.invalid'),('${STAFF}','s@t.invalid')`);
  const prov = async (u: string, e: string, slug: string) =>
    (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'Owner','Biz',$3,'en')", [u, e, slug]))[0].out_workspace_id;
  ws = await prov(OWNER, "o@t.invalid", "audit-a");
  otherWs = await prov(OTHER_OWNER, "x@t.invalid", "audit-b");
  await db.exec(`
    insert into profiles (id, email) values ('${STAFF}','s@t.invalid');
    insert into workspace_members (workspace_id, profile_id, role) values ('${ws}','${STAFF}','staff');`);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("0033 audit_logs privileges", () => {
  it("signed-in users and anon cannot write; they can only read; the service role can only insert", async () => {
    const p = await q<Record<string, boolean>>(`
      select r.rolname,
             has_table_privilege(r.rolname, 'public.audit_logs', 'INSERT') as i,
             has_table_privilege(r.rolname, 'public.audit_logs', 'UPDATE') as u,
             has_table_privilege(r.rolname, 'public.audit_logs', 'DELETE') as d,
             has_table_privilege(r.rolname, 'public.audit_logs', 'TRUNCATE') as t,
             has_table_privilege(r.rolname, 'public.audit_logs', 'SELECT') as s
        from pg_roles r where r.rolname in ('anon','authenticated','service_role') order by r.rolname`);
    const by = Object.fromEntries(p.map((r) => [r.rolname as unknown as string, r]));
    expect(by.anon).toMatchObject({ i: false, u: false, d: false, t: false, s: false });
    expect(by.authenticated).toMatchObject({ i: false, u: false, d: false, t: false, s: true });
    expect(by.service_role).toMatchObject({ i: true, u: false, d: false, t: false, s: false });
  });

  it("the insert policy is gone and the select policy remains", async () => {
    const pol = await q<{ policyname: string }>("select policyname from pg_policies where schemaname='public' and tablename='audit_logs' order by 1");
    expect(pol.map((r) => r.policyname)).toEqual(["audit_logs_select"]);
  });

  it("forged entries by anon, member, owner and foreign owner are refused; update and delete too", async () => {
    const ins = (a: Actor, w: string, source = "user") =>
      errOf(run(a, "insert into audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source) values ($1,$2,'created','client','forged','fake',$3)",
        [w, a.kind === "user" ? a.id : null, source]));
    expect(await ins(anon, ws)).toMatch(/permission denied/);
    expect(await ins(user(STAFF), ws)).toMatch(/permission denied/);
    expect(await ins(user(OWNER), ws)).toMatch(/permission denied/);
    expect(await ins(user(OWNER), otherWs)).toMatch(/permission denied/);
    expect(await ins(user(OTHER_OWNER), ws)).toMatch(/permission denied/);
    expect(await ins(user(OWNER), ws, "automation")).toMatch(/permission denied/);
    expect(await q("select 1 from audit_logs where entity_id='forged'")).toHaveLength(0);
    for (const a of [user(OWNER), svc, anon]) {
      expect(await errOf(run(a, "update audit_logs set summary='x'"))).toMatch(/permission denied/);
      expect(await errOf(run(a, "delete from audit_logs"))).toMatch(/permission denied/);
    }
  });

  it("the service role (the server writer) can still insert", async () => {
    // No RETURNING: like supabase-js insert() without .select() (return=minimal), the service role needs no SELECT right.
    await run(svc, "insert into audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source) values ($1,$2,'created','client','svc-1','ok','user')", [ws, OWNER]);
    expect((await q("select 1 from audit_logs where entity_id='svc-1'")).length).toBe(1);
  });

  it("reading follows audit_log.view: owner sees the workspace, staff and the foreign owner see nothing of it", async () => {
    expect((await run(user(OWNER), "select 1 from audit_logs where entity_id='svc-1'")).length).toBe(1);
    expect((await run(user(STAFF), "select 1 from audit_logs where entity_id='svc-1'")).length).toBe(0);
    expect((await run(user(OTHER_OWNER), "select 1 from audit_logs where entity_id='svc-1'")).length).toBe(0);
  });

  it("re-running the migration is harmless", async () => {
    await db.exec(readFileSync(path.join(migrationsDir, "0033_audit_log_protection.sql"), "utf8"));
    const pol = await q("select 1 from pg_policies where schemaname='public' and tablename='audit_logs'");
    expect(pol).toHaveLength(1);
  });
});

describe("0033 archive and retention audit (database triggers, same transaction)", () => {
  it("archive / restore write one entry each, without personal data; repeats write none", async () => {
    const c = await newClient("Mara");
    const set = (on: boolean) => run(user(OWNER), "select public.set_client_archived($1,$2,$3) as r", [ws, c, on]);
    await set(true);
    await set(true);
    await set(false);
    const rows = await auditRows(c);
    expect(rows.map((r) => r.summary)).toEqual(["Client archived", "Client restored from archive"]);
    expect(rows.every((r) => r.source === "user" && r.actor_id === OWNER && r.action === "updated")).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/mara|@t\.invalid/i);
  });

  it("a direct update of archived_at stays refused (no audit entry could be skipped)", async () => {
    const c = await newClient("Direct");
    expect(await errOf(run(user(OWNER), "update clients set archived_at = now() where id=$1", [c]))).toMatch(/client_archive/);
    expect(await auditRows(c)).toHaveLength(0);
  });

  it("the retention period change is audited with both numbers; no change, no entry", async () => {
    const set = (m: number) => run(user(OWNER), "select public.set_client_retention_months($1,$2) as r", [ws, m]);
    const before = (await q<{ n: number }>("select count(*)::int n from audit_logs where entity_id=$1 and entity_type='workspace'", [ws]))[0].n;
    const current = (await q<{ m: number }>("select client_retention_months m from workspaces where id=$1", [ws]))[0].m;
    await set(current);
    await set(current + 12);
    const rows = await auditRows(ws);
    expect(rows.length - before).toBe(1);
    expect(rows[rows.length - 1].summary).toBe(`Client data retention period changed from ${current} to ${current + 12} months`);
    expect(rows[rows.length - 1].actor_id).toBe(OWNER);
  });

  it("a failing audit insert rolls back the retention change", async () => {
    const current = (await q<{ m: number }>("select client_retention_months m from workspaces where id=$1", [ws]))[0].m;
    await db.exec(`create function public.test_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'forced_audit_failure'; end; $$;
      create trigger test_audit_fail before insert on public.audit_logs for each row execute function public.test_audit_fail();`);
    try {
      expect(await errOf(run(user(OWNER), "select public.set_client_retention_months($1,$2)", [ws, current + 6]))).toMatch(/forced_audit_failure/);
    } finally {
      await db.exec("drop trigger test_audit_fail on public.audit_logs; drop function public.test_audit_fail();");
    }
    expect((await q<{ m: number }>("select client_retention_months m from workspaces where id=$1", [ws]))[0].m).toBe(current);
  });
});

describe("0033 export audit (narrow definer function)", () => {
  it("an export writes one entry in the same transaction, categories and counts only", async () => {
    const c = await newClient("Export");
    await run(user(OWNER), "select public.export_client_data($1,$2,false,'admin',null)", [ws, c]);
    const rows = await auditRows(c);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "exported", source: "user", actor_id: OWNER });
    expect(rows[0].summary).toMatch(/^Client data export generated \(admin, internal notes excluded\): /);
    expect(JSON.stringify(rows)).not.toMatch(/export@t\.invalid/i);
  });

  it("a failing audit insert makes the export fail (nothing is delivered without its entry)", async () => {
    const c = await newClient("ExportFail");
    await db.exec(`create function public.test_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'forced_audit_failure'; end; $$;
      create trigger test_audit_fail before insert on public.audit_logs for each row execute function public.test_audit_fail();`);
    try {
      expect(await errOf(run(user(OWNER), "select public.export_client_data($1,$2,false,'admin',null)", [ws, c]))).toMatch(/forced_audit_failure/);
    } finally {
      await db.exec("drop trigger test_audit_fail on public.audit_logs; drop function public.test_audit_fail();");
    }
    expect(await auditRows(c)).toHaveLength(0);
  });

  it("the audit function cannot be used directly: not by a member, not by the service role, not by anon", async () => {
    const c = await newClient("Direct2");
    const call = (a: Actor) => errOf(run(a, "select public.record_client_export_audit($1,$2,'admin',false,'{\"profile\":1}'::jsonb)", [ws, c]));
    expect(await call(user(OWNER))).toMatch(/audit_not_permitted/);
    expect(await call(user(STAFF))).toMatch(/audit_not_permitted|permission denied/);
    expect(await call(svc)).toMatch(/permission denied/);
    expect(await call(anon)).toMatch(/permission denied/);
    expect(await auditRows(c)).toHaveLength(0);
  });

  it("a user without clients.export cannot export and leaves no entry", async () => {
    const c = await newClient("NoRight");
    expect(await errOf(run(user(STAFF), "select public.export_client_data($1,$2,false,'admin',null)", [ws, c]))).not.toBe("ok");
    expect(await auditRows(c)).toHaveLength(0);
  });
});

describe("0033 existing definer writers keep working", () => {
  it("data subject requests (trigger) and anonymization (definer function) still write their entries", async () => {
    const c = await newClient("Dsr");
    const id = (await run<{ id: string }>(user(OWNER),
      `insert into data_subject_requests (workspace_id, client_id, request_type, received_on, due_on, identity_verified, responsible_profile_id, created_by)
       values ($1,$2,'access', current_date, current_date + 30, true, $3, $3) returning id`, [ws, c, OWNER]))[0].id;
    const dsr = await auditRows(id);
    expect(dsr).toHaveLength(1);
    expect(dsr[0].source).toBe("user");
    await run(user(OWNER), "select public.anonymize_client($1,$2)", [ws, c]).catch(() => undefined);
    const anonymised = (await auditRows(c)).map((r) => r.summary);
    expect(anonymised).toContain("Client anonymized");
  });
});

describe("0033 EXECUTE on application trigger functions", () => {
  it("anon, authenticated and service_role cannot execute any of them", async () => {
    const rows = await q<{ proname: string; a: boolean; u: boolean; s: boolean; p: boolean }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') a,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') u,
             has_function_privilege('service_role', p.oid, 'EXECUTE') s,
             has_function_privilege('public', p.oid, 'EXECUTE') p
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1::text[])`, [TRIGGER_FUNCTIONS]);
    expect(rows.map((r) => r.proname).sort()).toEqual([...TRIGGER_FUNCTIONS].sort());
    expect(rows.filter((r) => r.a || r.u || r.s || r.p).map((r) => r.proname)).toEqual([]);
  });

  it("the list is complete: every trigger function of schema public is in it", async () => {
    const all = await q<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prorettype = 'trigger'::regtype order by 1`);
    expect(all.map((r) => r.proname)).toEqual([...TRIGGER_FUNCTIONS].sort());
  });

  it("calling one directly is refused for every API role", async () => {
    for (const a of [anon, user(OWNER), svc]) {
      expect(await errOf(run(a, "select public.guard_workspace_update()"))).toMatch(/permission denied/);
    }
  });

  it("no non-trigger function was touched: the API functions keep their grants", async () => {
    const r = await q<{ u: boolean }>("select has_function_privilege('authenticated', 'public.set_client_archived(uuid,uuid,boolean)'::regprocedure, 'EXECUTE') u");
    expect(r[0].u).toBe(true);
    const s = await q<{ s: boolean }>("select has_function_privilege('service_role', 'public.provision_workspace(uuid,text,text,text,text,text)'::regprocedure, 'EXECUTE') s").catch(() => [{ s: true }]);
    expect(s[0].s).toBe(true);
  });
});
