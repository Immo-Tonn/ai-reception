import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationFiles, type Actor } from "./pg";

/**
 * GDPR stage 6 — security check of everything GDPR stages 1–5 added
 * (migrations 0028–0032), plus the public booking functions that must keep
 * their access.
 *
 * COMPLETE mode (all of 0028–0032 present, i.e. the combined run): every
 * expected function, table and permission MUST exist — a missing object fails.
 * PARTIAL mode (e.g. this branch alone): only objects of the migrations that
 * are present are checked, and the full check is reported as SKIPPED with the
 * missing migrations in its title. A partial run is never a check of the system.
 */
const GDPR_MIGRATIONS = [
  "0028_client_anonymization.sql",
  "0029_client_data_export.sql",
  "0030_retention_dry_run.sql",
  "0031_client_retention_setting.sql",
  "0032_client_archiving.sql",
] as const;
type Migration = (typeof GDPR_MIGRATIONS)[number] | "existing";
const present = new Set(migrationFiles());
const missing = GDPR_MIGRATIONS.filter((m) => !present.has(m));
const complete = missing.length === 0;
const has = (m: Migration) => m === "existing" || present.has(m);

type Exec = { anon: boolean; authenticated: boolean; service_role?: boolean };
interface FnSpec {
  migration: Migration;
  signature: string; // regprocedure text
  security: "definer" | "invoker";
  exec: Exec;
  purpose: string;
}
/** Intended access per function (by purpose). Trigger functions are never callable by API roles. */
const FUNCTIONS: FnSpec[] = [
  { migration: "0028_client_anonymization.sql", signature: "public.anonymize_client(uuid,uuid)", security: "definer", exec: { anon: false, authenticated: true }, purpose: "owner action (checked inside)" },
  { migration: "0028_client_anonymization.sql", signature: "public.anonymize_client_core(uuid,uuid,uuid)", security: "definer", exec: { anon: false, authenticated: false, service_role: false }, purpose: "internal only" },
  { migration: "0028_client_anonymization.sql", signature: "public.reapply_client_erasures(jsonb)", security: "definer", exec: { anon: false, authenticated: false, service_role: true }, purpose: "restore procedure, service role" },
  { migration: "0028_client_anonymization.sql", signature: "public.guard_anonymized_client()", security: "definer", exec: { anon: false, authenticated: false }, purpose: "trigger" },
  { migration: "0028_client_anonymization.sql", signature: "public.guard_no_anonymized_client_ref()", security: "definer", exec: { anon: false, authenticated: false }, purpose: "trigger" },
  { migration: "0029_client_data_export.sql", signature: "public.export_client_data(uuid,uuid,boolean,text)", security: "invoker", exec: { anon: false, authenticated: true }, purpose: "owner/admin export (caller's RLS)" },
  { migration: "0029_client_data_export.sql", signature: "public.client_export_account_link(uuid,uuid)", security: "definer", exec: { anon: false, authenticated: true }, purpose: "count only, checked inside" },
  { migration: "0029_client_data_export.sql", signature: "public.guard_data_subject_request()", security: "definer", exec: { anon: false, authenticated: false }, purpose: "trigger" },
  { migration: "0030_retention_dry_run.sql", signature: "public.retention_dry_run(timestamp with time zone,timestamp with time zone)", security: "invoker", exec: { anon: false, authenticated: false, service_role: true }, purpose: "cron, service role" },
  { migration: "0031_client_retention_setting.sql", signature: "public.guard_workspace_retention_setting()", security: "definer", exec: { anon: false, authenticated: false }, purpose: "trigger" },
  { migration: "0032_client_archiving.sql", signature: "public.guard_client_archive()", security: "definer", exec: { anon: false, authenticated: false }, purpose: "trigger" },
  { migration: "0032_client_archiving.sql", signature: "public.guard_no_archived_client_ref()", security: "definer", exec: { anon: false, authenticated: false }, purpose: "trigger" },
  // Public online booking / client account: called by the server with the service role only. Must keep it.
  { migration: "existing", signature: "public.create_public_booking(uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text)", security: "definer", exec: { anon: false, authenticated: false, service_role: true }, purpose: "public booking" },
  { migration: "existing", signature: "public.get_public_booking_catalog(text)", security: "definer", exec: { anon: false, authenticated: false, service_role: true }, purpose: "public booking page" },
  { migration: "existing", signature: "public.claim_booking(uuid,text)", security: "definer", exec: { anon: false, authenticated: false, service_role: true }, purpose: "client account" },
  { migration: "existing", signature: "public.list_my_bookings(uuid,integer)", security: "definer", exec: { anon: false, authenticated: false, service_role: true }, purpose: "client account" },
  { migration: "existing", signature: "public.cancel_my_booking(uuid,uuid)", security: "definer", exec: { anon: false, authenticated: false, service_role: true }, purpose: "client account" },
  { migration: "existing", signature: "public.reschedule_my_booking(uuid,uuid,timestamp with time zone,uuid,uuid)", security: "definer", exec: { anon: false, authenticated: false, service_role: true }, purpose: "client account" },
];

type Priv = "select" | "insert" | "update" | "delete";
const TABLES: { migration: Migration; table: string; anon: Priv[]; authenticated: Priv[] }[] = [
  { migration: "0028_client_anonymization.sql", table: "client_erasure_ledger", anon: [], authenticated: [] },
  { migration: "0029_client_data_export.sql", table: "data_subject_requests", anon: [], authenticated: ["select", "insert", "update"] },
];

const PERMISSIONS: { migration: Migration; permission: string; roles: string[] }[] = [
  { migration: "0028_client_anonymization.sql", permission: "clients.erase", roles: ["owner"] },
  { migration: "0029_client_data_export.sql", permission: "clients.export", roles: ["admin", "owner"] },
  { migration: "0029_client_data_export.sql", permission: "clients.export_internal_notes", roles: ["owner"] },
  { migration: "0031_client_retention_setting.sql", permission: "retention.manage", roles: ["owner"] },
  { migration: "0032_client_archiving.sql", permission: "clients.archive", roles: ["admin", "owner"] },
];

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

beforeAll(async () => {
  db = await createMigratedDb();
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe(`GDPR security — ${complete ? "COMPLETE (0028–0032 present)" : `PARTIAL (missing: ${missing.join(", ")})`}`, () => {
  it.skipIf(complete)(`INCOMPLETE: the full GDPR security check needs ${missing.join(", ")} — run it combined with PR #18–#22`, () => {});

  for (const fn of FUNCTIONS.filter((f) => has(f.migration))) {
    it(`${fn.signature} — ${fn.purpose}: exists, ${fn.security}, search_path pinned, EXECUTE as intended`, async () => {
      const [row] = await q<{ definer: boolean; config: string[] | null; anon: boolean; auth: boolean; svc: boolean; pub: boolean }>(
        `select p.prosecdef as definer, p.proconfig as config,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as auth,
                has_function_privilege('service_role', p.oid, 'execute') as svc,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as pub
           from pg_proc p where p.oid = to_regprocedure($1)`,
        [fn.signature],
      );
      expect(row, `${fn.signature} must exist`).toBeTruthy();
      expect(row.definer).toBe(fn.security === "definer");
      expect(row.config ?? []).toContain('search_path=""');
      expect(row.pub, "EXECUTE must not be granted to PUBLIC").toBe(false);
      expect(row.anon).toBe(fn.exec.anon);
      expect(row.auth).toBe(fn.exec.authenticated);
      if (fn.exec.service_role !== undefined) expect(row.svc).toBe(fn.exec.service_role);
    });
  }

  for (const t of TABLES.filter((x) => has(x.migration))) {
    it(`table ${t.table}: exists, RLS on, privileges as intended`, async () => {
      const [row] = await q<{ rls: boolean }>("select relrowsecurity as rls from pg_class where oid = to_regclass($1)", [`public.${t.table}`]);
      expect(row, `${t.table} must exist`).toBeTruthy();
      expect(row.rls).toBe(true);
      for (const role of ["anon", "authenticated"] as const) {
        for (const priv of ["select", "insert", "update", "delete"] as const) {
          const [{ ok }] = await q<{ ok: boolean }>("select has_table_privilege($1, $2, $3) as ok", [role, `public.${t.table}`, priv]);
          expect(ok, `${role} ${priv} ${t.table}`).toBe(t[role].includes(priv));
        }
      }
    });
  }

  for (const p of PERMISSIONS.filter((x) => has(x.migration))) {
    it(`permission ${p.permission} only for ${p.roles.join(", ")}`, async () => {
      const rows = await q<{ role: string }>("select role::text as role from role_permissions where permission=$1 order by role", [p.permission]);
      expect(rows.map((r) => r.role)).toEqual(p.roles);
    });
  }
});

/* ------------------------------------------------------------------ */
/* Workspace isolation A/B for the critical GDPR operations (complete mode). */
/* ------------------------------------------------------------------ */
const OWNER_A = "aaaaaaaa-0000-4000-8000-0000000006a1";
const OWNER_B = "bbbbbbbb-0000-4000-8000-0000000006b1";
const ADMIN_B = "cccccccc-0000-4000-8000-0000000006b2";
const svc: Actor = { kind: "service" };
const user = (id: string): Actor => ({ kind: "user", id });
const errOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: { message?: string }) => e.message ?? "error");

describe.skipIf(!complete)(`GDPR workspace isolation A/B${complete ? "" : ` — SKIPPED (missing: ${missing.join(", ")})`}`, () => {
  let wsA: string, wsB: string, clientA: string, archivedA: string, anonymizedA: string, apptA: string, staffB: string, svcB: string;
  const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) =>
    as(db, actor, async () => (await db.query<T>(sql, p)).rows);
  /** Everything of workspace A an attacker could try to read or change. */
  const snapshotA = () =>
    q<{ s: string }>(`select md5(string_agg(t, '' order by t)) as s from (
      select to_jsonb(c)::text t from clients c where c.workspace_id = $1
      union all select to_jsonb(a)::text from appointments a where a.workspace_id = $1
      union all select to_jsonb(w)::text from workspaces w where w.id = $1
      union all select to_jsonb(d)::text from data_subject_requests d where d.workspace_id = $1
      union all select to_jsonb(l)::text from client_erasure_ledger l where l.workspace_id = $1
      union all select to_jsonb(g)::text from audit_logs g where g.workspace_id = $1) x`, [wsA]).then((r) => r[0].s);

  beforeAll(async () => {
    await db.exec(`insert into auth.users (id,email) values ('${OWNER_A}','a@t.invalid'),('${OWNER_B}','b@t.invalid'),('${ADMIN_B}','ab@t.invalid')`);
    const prov = async (u: string, e: string, slug: string) =>
      (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'Owner','Biz',$3,'en')", [u, e, slug]))[0].out_workspace_id;
    wsA = await prov(OWNER_A, "a@t.invalid", "iso-a");
    wsB = await prov(OWNER_B, "b@t.invalid", "iso-b");
    await db.exec(`insert into profiles (id,email) values ('${ADMIN_B}','ab@t.invalid'); insert into workspace_members (workspace_id,profile_id,role) values ('${wsB}','${ADMIN_B}','admin')`);
    clientA = (await q<{ id: string }>("insert into clients (workspace_id,name,email,phone,notes) values ($1,'Alice A','alice@t.invalid','+49 1','secret') returning id", [wsA]))[0].id;
    archivedA = (await q<{ id: string }>("insert into clients (workspace_id,name,archived_at) values ($1,'Archived A', now()) returning id", [wsA]))[0].id;
    anonymizedA = (await q<{ id: string }>("insert into clients (workspace_id,name) values ($1,'To Anonymise A') returning id", [wsA]))[0].id;
    await q("select public.anonymize_client_core($1,$2,null)", [wsA, anonymizedA]);
    const staffA = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsA]))[0].id;
    const svcA = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes) values ($1,'Cut',30) returning id", [wsA]))[0].id;
    apptA = (await q<{ id: string }>(`insert into appointments (workspace_id, client_id, service_id, staff_id, status, starts_at, ends_at, timezone, internal_notes)
      values ($1,$2,$3,$4,'confirmed', now() + interval '5 days', now() + interval '5 days 30 minutes', 'Europe/Berlin', 'A internal') returning id`, [wsA, clientA, svcA, staffA]))[0].id;
    staffB = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsB]))[0].id;
    svcB = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes) values ($1,'Cut',30) returning id", [wsB]))[0].id;
  });

  for (const attacker of [OWNER_B, ADMIN_B]) {
    const who = attacker === OWNER_B ? "owner B" : "admin B";

    it(`${who}: export of A's client is refused and changes nothing`, async () => {
      const before = await snapshotA();
      expect(await errOf(run(user(attacker), "select public.export_client_data($1,$2,false,'admin')", [wsA, clientA]))).toMatch(/client_export_not_permitted/);
      expect(await errOf(run(user(attacker), "select public.export_client_data($1,$2,false,'admin')", [wsB, clientA]))).toMatch(/client_not_found/);
      expect(await errOf(run(user(attacker), "select public.client_export_account_link($1,$2)", [wsA, clientA]))).toMatch(/client_export_not_permitted/);
      expect(await snapshotA()).toBe(before);
    });

    it(`${who}: anonymisation of A's client is refused and changes nothing`, async () => {
      const before = await snapshotA();
      expect(await errOf(run(user(attacker), "select public.anonymize_client($1,$2)", [wsA, clientA]))).toMatch(/client_erase_not_permitted/);
      const own = await errOf(run(user(attacker), "select public.anonymize_client($1,$2)", [wsB, clientA]));
      expect(own).toMatch(attacker === OWNER_B ? /client_not_found/ : /client_erase_not_permitted/);
      expect(await snapshotA()).toBe(before);
    });

    it(`${who}: archiving / restoring A's clients changes nothing`, async () => {
      const before = await snapshotA();
      expect(await run(user(attacker), "update clients set archived_at = now() where id=$1 returning id", [clientA])).toEqual([]);
      expect(await run(user(attacker), "update clients set archived_at = null where id=$1 returning id", [archivedA])).toEqual([]);
      expect(await snapshotA()).toBe(before);
    });

    it(`${who}: requests register, retention setting and appointments of A are out of reach`, async () => {
      const before = await snapshotA();
      expect(await errOf(run(user(attacker),
        "insert into data_subject_requests (workspace_id, client_id, received_on, due_on, created_by) values ($1,$2,current_date,current_date+30,$3)",
        [wsA, clientA, attacker]))).toMatch(/row-level security/);
      expect(await run(user(attacker), "select id from data_subject_requests where workspace_id=$1", [wsA])).toEqual([]);
      expect(await run(user(attacker), "update workspaces set client_retention_months = 12 where id=$1 returning id", [wsA])).toEqual([]);
      expect(await run(user(attacker), "update appointments set internal_notes = 'x' where id=$1 returning id", [apptA])).toEqual([]);
      expect(await snapshotA()).toBe(before);
    });

    it(`${who}: A's active, archived and anonymised clients are indistinguishable from B, and nothing of A changes`, async () => {
      const before = await snapshotA();
      const answers: Record<string, string[]> = {};
      for (const [label, id] of [["active", clientA], ["archived", archivedA], ["anonymised", anonymizedA]] as const) {
        const offset = 200 + Object.keys(answers).length;
        answers[label] = [
          await errOf(run(user(attacker),
            `insert into appointments (workspace_id, client_id, service_id, staff_id, status, starts_at, ends_at, timezone, created_by)
             values ($1,$2,$3,$4,'confirmed', now() + make_interval(days => $6), now() + make_interval(days => $6, mins => 30), 'Europe/Berlin', $5)`,
            [wsB, id, svcB, staffB, attacker, offset])),
          await errOf(run(user(attacker),
            "insert into waiting_list (workspace_id, client_id, service_id, earliest_date, latest_date) values ($1,$2,$3,current_date+1,current_date+5)",
            [wsB, id, svcB])),
          await errOf(run(user(attacker), "select public.export_client_data($1,$2,false,'admin')", [wsA, id])),
          await errOf(run(user(attacker), "select public.export_client_data($1,$2,false,'admin')", [wsB, id])),
          await errOf(run(user(attacker), "select public.anonymize_client($1,$2)", [wsA, id])),
          await errOf(run(user(attacker), "select public.anonymize_client($1,$2)", [wsB, id])),
          JSON.stringify(await run(user(attacker), "update clients set archived_at = now() where id=$1 returning id", [id])),
          JSON.stringify(await run(user(attacker), "update clients set archived_at = null where id=$1 returning id", [id])),
        ];
      }
      // Same answer for every kind of foreign client: nothing reveals its status.
      expect(answers.archived).toEqual(answers.active);
      expect(answers.anonymised).toEqual(answers.active);
      for (const a of Object.values(answers).flat()) expect(a).not.toMatch(/client_archived|client_anonymized/);
      expect(answers.active[0]).toMatch(/cross_workspace_reference/);
      expect(await snapshotA()).toBe(before);
    });
  }

  it("service-only GDPR functions refuse every API user (also A's own owner)", async () => {
    for (const actor of [user(OWNER_A), user(OWNER_B), { kind: "anon" } as Actor]) {
      expect(await errOf(run(actor, "select public.reapply_client_erasures('[]'::jsonb)"))).toMatch(/permission denied/);
      expect(await errOf(run(actor, "select public.retention_dry_run(now() - interval '1 year', now() - interval '1 year')"))).toMatch(/permission denied/);
      expect(await errOf(run(actor, "select public.anonymize_client_core($1,$2,null)", [wsA, clientA]))).toMatch(/permission denied/);
    }
  });

  it("the public online booking path (service role) still works after all GDPR migrations", async () => {
    const starts = (await q<{ s: string }>(
      `select (((now() at time zone 'Europe/Berlin')::date + ((8 - extract(isodow from (now() at time zone 'Europe/Berlin'))::int) % 7 + 7)
        + time '11:00') at time zone 'Europe/Berlin')::text as s`))[0].s;
    const [b] = await run<{ out_status: string }>(svc, "select * from public.create_public_booking($1,$2,$3,null,$4::timestamptz,'Guest','guest@t.invalid','+49 2','')", [wsB, svcB, staffB, starts]);
    expect(b.out_status).toBeTruthy();
  });

  it("own workspace keeps the clear messages: archived and anonymised clients are refused with their status", async () => {
    const staffA = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsA]))[0].id;
    const svcA = (await q<{ id: string }>("select id from services where workspace_id=$1 limit 1", [wsA]))[0].id;
    const book = (id: string, days: number) => errOf(run(user(OWNER_A),
      `insert into appointments (workspace_id, client_id, service_id, staff_id, status, starts_at, ends_at, timezone, created_by)
       values ($1,$2,$3,$4,'confirmed', now() + make_interval(days => $6), now() + make_interval(days => $6, mins => 30), 'Europe/Berlin', $5)`,
      [wsA, id, svcA, staffA, OWNER_A, days]));
    expect(await book(archivedA, 400)).toMatch(/client_archived/);
    expect(await book(anonymizedA, 401)).toMatch(/client_anonymized/);
  });
});
