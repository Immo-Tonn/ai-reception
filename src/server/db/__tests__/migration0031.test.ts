import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

/**
 * 0031: workspaces.client_retention_months (owner only, 12..120, default 36) and
 * the retention dry run using each workspace's own period. PGlite, synthetic data.
 */
const OWNER = "aaaaaaaa-0000-4000-8000-0000000000d1";
const OTHER_OWNER = "bbbbbbbb-0000-4000-8000-0000000000d2";
const ADMIN = "cccccccc-0000-4000-8000-0000000000d3";
const MANAGER = "dddddddd-0000-4000-8000-0000000000d4";
const STAFF = "eeeeeeee-0000-4000-8000-0000000000d5";
const ACCOUNTANT = "ffffffff-0000-4000-8000-0000000000d6";
const svc: Actor = { kind: "service" };
const user = (id: string): Actor => ({ kind: "user", id });

let db: PGlite;
let ws: string, otherWs: string;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) =>
  as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const errOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: { message?: string }) => e.message ?? "error");
const months = async (w: string) => (await q<{ m: number }>("select client_retention_months as m from workspaces where id=$1", [w]))[0].m;
const setMonths = (actor: Actor, w: string, m: unknown) =>
  run<{ r: { status: string; months: number } }>(actor, "select public.set_client_retention_months($1,$2) as r", [w, m]).then((rows) => rows[0].r);
const directUpdate = (actor: Actor, w: string, m: number) =>
  run<{ id: string }>(actor, "update workspaces set client_retention_months = $2 where id = $1 returning id", [w, m]);
const auditCount = async (w: string) => (await q<{ n: number }>("select count(*)::int as n from audit_logs where workspace_id=$1 and summary like 'Client data retention%'", [w]))[0].n;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values
    ('${OWNER}','o@t.invalid'),('${OTHER_OWNER}','x@t.invalid'),('${ADMIN}','a@t.invalid'),
    ('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid')`);
  const prov = async (u: string, e: string, slug: string) =>
    (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'Owner','Biz',$3,'en')", [u, e, slug]))[0].out_workspace_id;
  ws = await prov(OWNER, "o@t.invalid", "keep-a");
  otherWs = await prov(OTHER_OWNER, "x@t.invalid", "keep-b");
  await db.exec(`
    insert into profiles (id, email) values ('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid');
    insert into workspace_members (workspace_id, profile_id, role) values
      ('${ws}','${ADMIN}','admin'),('${ws}','${MANAGER}','manager'),('${ws}','${STAFF}','staff'),('${ws}','${ACCOUNTANT}','accountant');`);
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("0031 client retention setting", () => {
  it("is idempotent as a migration", async () => {
    await db.exec(readFileSync(path.join(migrationsDir, "0031_client_retention_setting.sql"), "utf8"));
  });

  it("defaults to 36 months for every workspace (existing and new)", async () => {
    expect(await months(ws)).toBe(36);
    expect(await months(otherWs)).toBe(36);
  });

  it("the owner saves a new period and reads it back", async () => {
    expect(await setMonths(user(OWNER), ws, 48)).toEqual({ status: "changed", months: 48 });
    expect(await months(ws)).toBe(48);
    expect((await run<{ m: number }>(user(OWNER), "select client_retention_months as m from workspaces where id=$1", [ws]))[0].m).toBe(48);
  });

  it("admin may read but not change it (even directly); other settings stay editable for the admin", async () => {
    expect((await run<{ m: number }>(user(ADMIN), "select client_retention_months as m from workspaces where id=$1", [ws]))[0].m).toBe(48);
    expect(await errOf(setMonths(user(ADMIN), ws, 24))).toMatch(/retention_setting_not_permitted/);
    expect(await errOf(directUpdate(user(ADMIN), ws, 24))).toMatch(/retention_setting_not_permitted/);
    await run(user(ADMIN), "update workspaces set min_notice_minutes = 30 where id = $1", [ws]); // no regression
    expect(await months(ws)).toBe(48);
  });

  it("manager, staff, accountant, another workspace's owner, anon and the service role cannot use it", async () => {
    for (const id of [MANAGER, STAFF, ACCOUNTANT, OTHER_OWNER]) {
      expect(await errOf(setMonths(user(id), ws, 24)), id).toMatch(/retention_setting_not_permitted/);
      expect(await directUpdate(user(id), ws, 24), id).toEqual([]); // RLS: the row is not updatable
    }
    expect(await errOf(setMonths({ kind: "anon" }, ws, 24))).toMatch(/permission denied/);
    expect(await errOf(setMonths(svc, ws, 24))).toMatch(/permission denied/);
    expect(await months(ws)).toBe(48);
    expect(await months(otherWs)).toBe(36);
  });

  it("a direct UPDATE is refused even for the owner (it would leave no audit entry)", async () => {
    expect(await errOf(directUpdate(user(OWNER), ws, 24))).toMatch(/retention_setting_use_function/);
    expect(await months(ws)).toBe(48);
  });

  it("the same value writes nothing; a change writes exactly one entry without personal data", async () => {
    const before = await auditCount(ws);
    expect(await setMonths(user(OWNER), ws, 48)).toEqual({ status: "unchanged", months: 48 });
    expect(await auditCount(ws)).toBe(before);
    await setMonths(user(OWNER), ws, 60);
    expect(await auditCount(ws)).toBe(before + 1);
    const [row] = await q<{ summary: string; actor_id: string; source: string }>("select summary, actor_id, source from audit_logs where workspace_id=$1 and summary like 'Client data retention%' order by created_at desc limit 1", [ws]);
    expect(row).toEqual({ summary: "Client data retention period changed from 48 to 60 months", actor_id: OWNER, source: "user" });
    await setMonths(user(OWNER), ws, 48);
  });

  it("a failed audit entry rolls the value back", async () => {
    await db.exec(`create function public.test_audit_fail() returns trigger language plpgsql as $$ begin raise exception 'forced_audit_failure'; end; $$;
      create trigger test_audit_fail before insert on public.audit_logs for each row execute function public.test_audit_fail();`);
    try {
      expect(await errOf(setMonths(user(OWNER), ws, 24))).toMatch(/forced_audit_failure/);
    } finally {
      await db.exec("drop trigger test_audit_fail on public.audit_logs; drop function public.test_audit_fail();");
    }
    expect(await months(ws)).toBe(48);
  });

  it("set_client_retention_months: invoker, search_path pinned, EXECUTE for authenticated only", async () => {
    const [f] = await q<{ definer: boolean; config: string[]; pub: boolean; anon: boolean; auth: boolean; svc: boolean }>(
      `select p.prosecdef as definer, p.proconfig as config,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as auth,
              has_function_privilege('service_role', p.oid, 'execute') as svc
         from pg_proc p where p.oid = to_regprocedure('public.set_client_retention_months(uuid,integer)')`);
    expect(f).toMatchObject({ definer: false, pub: false, anon: false, auth: true, svc: false });
    expect(f.config).toContain('search_path=""');
  });

  it("rejects zero, negative, out-of-range and fractional values", async () => {
    for (const bad of [0, -12, 11, 121, 1000]) {
      expect(await errOf(setMonths(user(OWNER), ws, bad)), String(bad)).toMatch(/client_retention_months_chk/);
    }
    expect(await errOf(setMonths(user(OWNER), ws, "12.5"))).toMatch(/invalid input syntax/);
    for (const ok of [12, 120]) {
      await setMonths(user(OWNER), ws, ok);
      expect(await months(ws)).toBe(ok);
    }
  });

  it("only the owner holds retention.manage", async () => {
    const rows = await q<{ role: string }>("select role from role_permissions where permission='retention.manage'");
    expect(rows.map((r) => r.role)).toEqual(["owner"]);
  });
});

describe("0031 dry run with each workspace's own period", () => {
  let staffA: string, staffB: string, svcA: string, svcB: string;
  async function clientWithVisit(w: string, monthsAgo: number) {
    const [st, sv] = w === ws ? [staffA, svcA] : [staffB, svcB];
    const id = (await q<{ id: string }>("insert into clients (workspace_id,name,created_at) values ($1,'Synthetic', now() - interval '20 years') returning id", [w]))[0].id;
    await q(`insert into appointments (workspace_id, client_id, service_id, staff_id, status, starts_at, ends_at, timezone)
      values ($1,$2,$3,$4,'completed', now() - make_interval(months => $5), now() - make_interval(months => $5) + interval '15 minutes', 'Europe/Berlin')`,
      [w, id, sv, st, monthsAgo]);
    return id;
  }
  const snapshot = () =>
    q<{ s: string }>("select md5(string_agg(t, '' order by t)) as s from (select to_jsonb(c)::text t from clients c union all select to_jsonb(a)::text from appointments a) x").then((r) => r[0].s);

  beforeAll(async () => {
    staffA = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [ws]))[0].id;
    staffB = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [otherWs]))[0].id;
    svcA = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes) values ($1,'Cut',15) returning id", [ws]))[0].id;
    svcB = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes) values ($1,'Cut',15) returning id", [otherWs]))[0].id;
    await setMonths(user(OWNER), ws, 12);          // A: 12 months
    await setMonths(user(OTHER_OWNER), otherWs, 120); // B: 120 months
    await clientWithVisit(ws, 24);       // A: 24 months ago -> candidate (period 12)
    await clientWithVisit(otherWs, 24);  // B: 24 months ago -> NOT a candidate (period 120)
    await clientWithVisit(otherWs, 130); // B: 130 months ago -> candidate
  });

  it("counts candidates per workspace period, not one global value", async () => {
    const before = await snapshot();
    const [{ r }] = await run<{ r: { clients: Record<string, unknown> } }>(svc,
      "select public.retention_dry_run(now() - interval '36 months', now() - interval '12 months') as r");
    expect(r.clients).toMatchObject({ candidates: 2, recentVisit: 1, periodSource: "workspace_setting" });
    expect(await snapshot()).toBe(before); // counting only
  });

  it("the dry run stays service-role only", async () => {
    expect(await errOf(run(user(OWNER), "select public.retention_dry_run(now() - interval '1 year', now() - interval '1 year')"))).toMatch(/permission denied/);
  });
});
