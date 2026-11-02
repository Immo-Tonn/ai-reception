import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

/**
 * 0028: client anonymisation (owner only, one transaction, idempotent, ledger,
 * re-apply after restore). Real PostgreSQL (PGlite), synthetic data only.
 */
const OWNER = "aaaaaaaa-0000-4000-8000-0000000000f1";
const OTHER_OWNER = "bbbbbbbb-0000-4000-8000-0000000000f2";
const ADMIN = "cccccccc-0000-4000-8000-0000000000f3";
const MANAGER = "dddddddd-0000-4000-8000-0000000000f4";
const STAFF = "eeeeeeee-0000-4000-8000-0000000000f5";
const ACCOUNTANT = "ffffffff-0000-4000-8000-0000000000f6";
const ACCOUNT_USER = "abababab-0000-4000-8000-0000000000f7";
const svc: Actor = { kind: "service" };
const user = (id: string): Actor => ({ kind: "user", id });

const NAME = "Anna Ivanova";
const EMAIL = "anna@t.invalid";
const PHONE = "+49 30 1234567";
const LABEL = "Gelöschter Kunde";

let db: PGlite;
let seq = 0; // distinct day per seeded appointment (staff overlap constraint)
let ws: string, otherWs: string, staff: string, service: string, bucket: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) =>
  as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const errOf = async (p: Promise<unknown>) => p.then(() => "ok", (e: { message?: string }) => e.message ?? "error");
const anonymize = (actor: Actor, workspace: string, client: string) =>
  run<{ r: Record<string, unknown> }>(actor, "select public.anonymize_client($1,$2) as r", [workspace, client]).then((rows) => rows[0].r);

/** A client with data in every source found in the stage-0 audit. */
async function seedClient(workspace: string, name = NAME, email = EMAIL) {
  const client = (await q<{ id: string }>(
    "insert into clients (workspace_id,name,email,phone,tags,notes) values ($1,$2,$3,$4,'{vip}','likes tea') returning id",
    [workspace, name, email, PHONE],
  ))[0].id;
  const wsStaff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1 limit 1", [workspace]))[0].id;
  const wsService = workspace === ws ? service
    : (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Cut',30,20) returning id", [workspace]))[0].id;
  const wsBucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [workspace]))[0].id;
  const appt = (await q<{ id: string }>(
    `insert into appointments (workspace_id, client_id, service_id, staff_id, financial_bucket_id, status, starts_at, ends_at, timezone, client_notes, internal_notes, title)
     values ($1,$2,$3,$4,$5,'confirmed', now() + make_interval(days => $9), now() + make_interval(days => $9, mins => 45), 'Europe/Berlin', $6, $7, $8) returning id`,
    [workspace, client, wsService, wsStaff, wsBucket, `call ${PHONE}`, `${NAME} allergy`, NAME, 3 + seq++],
  ))[0].id;
  await q("insert into booking_claims (appointment_id, token_hash, claimed_by, claimed_at, expires_at) values ($1, md5(random()::text), $2, now(), now() + interval '1 day')", [appt, ACCOUNT_USER]);
  await q("insert into waiting_list (workspace_id, client_id, service_id, guest_name, guest_phone, guest_email, notes, earliest_date, latest_date) values ($1,$2,$3,$4,$5,$6,'mornings', current_date + 1, current_date + 14)", [workspace, client, wsService, name, PHONE, email]);
  await q("insert into leads (workspace_id, client_id, client_name, title, notes) values ($1,$2,$3,'Wedding',$4)", [workspace, client, name, `${name}, ${email}`]);
  const invoice = (await q<{ id: string }>(
    "insert into invoices (workspace_id, client_id, client_name, number, status) values ($1,$2,$3,$4,'draft') returning id",
    [workspace, client, name, `T-${client.slice(0, 8)}`],
  ))[0].id;
  return { client, appt, invoice };
}

const clientRow = (id: string) => q<Record<string, unknown>>("select name,email,phone,tags,notes,anonymized_at from clients where id=$1", [id]).then((r) => r[0]);
const invoiceRow = (id: string) => q<{ j: unknown }>("select to_jsonb(i) - 'updated_at' as j from invoices i where id=$1", [id]).then((r) => r[0].j);
/** Every text of the client's rows in the audited sources, to search for leftovers. */
async function leftovers(workspace: string, client: string, appt: string) {
  const rows = await q<{ t: string }>(
    `select coalesce((select to_jsonb(c)::text from clients c where c.id=$2),'') ||
            coalesce((select string_agg(to_jsonb(a)::text, '') from appointments a where a.client_id=$2),'') ||
            coalesce((select string_agg(to_jsonb(w)::text, '') from waiting_list w where w.client_id=$2),'') ||
            coalesce((select string_agg(to_jsonb(l)::text, '') from leads l where l.client_id=$2),'') ||
            coalesce((select string_agg(e.preview || e.details::text, '') from inbox_events e where e.workspace_id=$1),'') ||
            coalesce((select string_agg(to_jsonb(g)::text, '') from audit_logs g where g.workspace_id=$1),'') ||
            coalesce((select string_agg(to_jsonb(b)::text, '') from booking_claims b where b.appointment_id=$3),'') as t`,
    [workspace, client, appt],
  );
  const text = rows[0].t;
  return [NAME, "Anna", EMAIL, PHONE, "likes tea", "allergy", "mornings"].filter((s) => text.includes(s));
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values
    ('${OWNER}','o@t.invalid'),('${OTHER_OWNER}','x@t.invalid'),('${ADMIN}','a@t.invalid'),
    ('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid'),('${ACCOUNT_USER}','u@t.invalid')`);
  const prov = async (u: string, e: string, slug: string) =>
    (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'Owner','Biz',$3,'en')", [u, e, slug]))[0].out_workspace_id;
  ws = await prov(OWNER, "o@t.invalid", "erase-a");
  otherWs = await prov(OTHER_OWNER, "x@t.invalid", "erase-b");
  await db.exec(`
    insert into profiles (id, email) values ('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid');
    insert into workspace_members (workspace_id, profile_id, role) values
      ('${ws}','${ADMIN}','admin'),('${ws}','${MANAGER}','manager'),('${ws}','${STAFF}','staff'),('${ws}','${ACCOUNTANT}','accountant');`);
  staff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [ws]))[0].id;
  service = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Manicure',45,30) returning id", [ws]))[0].id;
  bucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [ws]))[0].id;
}, 120_000);

afterAll(async () => {
  await db.close();
});

describe("0028 client anonymisation", () => {
  it("is idempotent as a migration", async () => {
    await db.exec(readFileSync(path.join(migrationsDir, "0028_client_anonymization.sql"), "utf8"));
  });

  it("only the owner may anonymise; every other role and anon are refused", async () => {
    const { client } = await seedClient(ws, "Role Test", "role@t.invalid");
    for (const id of [ADMIN, MANAGER, STAFF, ACCOUNTANT, OTHER_OWNER]) {
      expect(await errOf(anonymize(user(id), ws, client))).toMatch(/client_erase_not_permitted/);
    }
    expect(await errOf(anonymize({ kind: "anon" }, ws, client))).toMatch(/permission denied/);
    expect(await errOf(run(user(OWNER), "select public.anonymize_client_core($1,$2,null)", [ws, client]))).toMatch(/permission denied/);
    expect(await errOf(run(user(OWNER), "select public.reapply_client_erasures('[]'::jsonb)"))).toMatch(/permission denied/);
    expect(await errOf(run(user(OWNER), "select * from client_erasure_ledger"))).toMatch(/permission denied/);
    expect((await clientRow(client)).anonymized_at).toBeNull();
  });

  it("workspace isolation: another workspace's client looks like a missing one", async () => {
    const b = await seedClient(otherWs, "Bob Other", "bob@t.invalid");
    expect(await errOf(anonymize(user(OWNER), ws, b.client))).toMatch(/client_not_found/);
    expect(await errOf(anonymize(user(OWNER), otherWs, b.client))).toMatch(/client_erase_not_permitted/);
    expect((await clientRow(b.client)).name).toBe("Bob Other");
  });

  it("removes / pseudonymises personal data, keeps invoices and history unchanged", async () => {
    const { client, appt, invoice } = await seedClient(ws);
    const b = await seedClient(otherWs, NAME, EMAIL); // same person in workspace B: untouched
    await run(user(OWNER), "update appointments set status='cancelled' where id=$1", [appt]); // Inbox snapshot with the name
    const invoiceBefore = await invoiceRow(invoice);
    const apptBefore = (await q("select starts_at, ends_at, status, service_id, price, currency from appointments where id=$1", [appt]))[0];
    expect((await leftovers(ws, client, appt)).length).toBeGreaterThan(0);

    const result = await anonymize(user(OWNER), ws, client);
    expect(result).toMatchObject({ status: "anonymized", appointments: 1, bookingClaims: 1, waitingList: 1, workItems: 1 });

    const row = await clientRow(client);
    expect(row).toMatchObject({ name: LABEL, email: "", phone: "", tags: [], notes: "" });
    expect(row.anonymized_at).not.toBeNull();
    expect(await leftovers(ws, client, appt)).toEqual([]);
    expect((await q("select client_name from leads where client_id=$1", [client]))[0].client_name).toBe(LABEL);
    // C: the invoice and the appointment's facts stay as they were.
    expect(await invoiceRow(invoice)).toEqual(invoiceBefore);
    // The client account is unlinked from the appointment and its booking token expired.
    const [claim] = await q<{ claimed_by: string | null; expired: boolean }>("select claimed_by, expires_at <= now() as expired from booking_claims where appointment_id=$1", [appt]);
    expect(claim).toEqual({ claimed_by: null, expired: true });
    expect((await q("select starts_at, ends_at, status, service_id, price, currency from appointments where id=$1", [appt]))[0]).toEqual(apptBefore);
    // Workspace B is untouched.
    expect((await clientRow(b.client)).email).toBe(EMAIL);
    // Ledger: ids only.
    const ledger = await q("select * from client_erasure_ledger where client_id=$1", [client]);
    expect(Object.keys(ledger[0]).sort()).toEqual(["client_id", "erased_at", "workspace_id"]);
    // Audit: one fixed-text entry without personal data.
    const audit = await q<{ summary: string; actor_id: string }>("select summary, actor_id from audit_logs where entity_id=$1 and entity_type='client'", [client]);
    expect(audit).toEqual([{ summary: "Client anonymized", actor_id: OWNER }]);
  });

  it("is idempotent: a second call changes nothing", async () => {
    const { client } = await seedClient(ws, "Twice Client", "twice@t.invalid");
    await anonymize(user(OWNER), ws, client);
    const before = await clientRow(client);
    expect(await anonymize(user(OWNER), ws, client)).toEqual({ status: "already" });
    expect(await clientRow(client)).toEqual(before);
    expect((await q("select count(*)::int as n from audit_logs where entity_id=$1", [client]))[0].n).toBe(1);
  });

  it("freezes the anonymised row and blocks new bookings for it", async () => {
    const { client } = await seedClient(ws, "Frozen Client", "frozen@t.invalid");
    await anonymize(user(OWNER), ws, client);
    expect(await errOf(run(user(OWNER), "update clients set email='new@t.invalid' where id=$1", [client]))).toMatch(/client_anonymized/);
    expect(await errOf(run(user(OWNER), "update clients set anonymized_at=null where id=$1", [client]))).toMatch(/client_anonymized/);
    expect(await errOf(q(
      `insert into appointments (workspace_id, client_id, service_id, staff_id, financial_bucket_id, status, starts_at, ends_at, timezone)
       values ($1,$2,$3,$4,$5,'confirmed', now() + interval '200 days', now() + interval '200 days 30 minutes', 'Europe/Berlin')`,
      [ws, client, service, staff, bucket]))).toMatch(/client_anonymized/);
    expect(await errOf(q("insert into waiting_list (workspace_id, client_id, service_id, earliest_date, latest_date) values ($1,$2,$3, current_date + 1, current_date + 14)", [ws, client, service]))).toMatch(/client_anonymized/);
    // Setting the marker directly is refused too.
    const { client: other } = await seedClient(ws, "Direct Marker", "direct@t.invalid");
    expect(await errOf(run(user(OWNER), "update clients set anonymized_at=now() where id=$1", [other]))).toMatch(/client_anonymized/);
  });

  it("the anonymisation status is not revealed to another workspace or a role without client access", async () => {
    const { client } = await seedClient(ws, "Hidden Status", "hidden@t.invalid");
    await anonymize(user(OWNER), ws, client);
    const otherStaff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [otherWs]))[0].id;
    const otherSvc = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes) values ($1,'Cut',30) returning id", [otherWs]))[0].id;
    const fromOther = await errOf(run(user(OTHER_OWNER),
      `insert into appointments (workspace_id, client_id, service_id, staff_id, status, starts_at, ends_at, timezone, created_by)
       values ($1,$2,$3,$4,'confirmed', now() + interval '300 days', now() + interval '300 days 30 minutes', 'Europe/Berlin', $5)`,
      [otherWs, client, otherSvc, otherStaff, OTHER_OWNER]));
    expect(fromOther).toMatch(/cross_workspace_reference/);
    expect(fromOther).not.toMatch(/client_anonymized/);
    const accountant = await errOf(run(user(ACCOUNTANT),
      `insert into appointments (workspace_id, client_id, service_id, staff_id, status, starts_at, ends_at, timezone, created_by)
       values ($1,$2,$3,$4,'confirmed', now() + interval '301 days', now() + interval '301 days 30 minutes', 'Europe/Berlin', $5)`,
      [ws, client, service, staff, ACCOUNTANT]));
    expect(accountant).not.toMatch(/client_anonymized/);
    expect(accountant).toMatch(/row-level security/);
  });

  it("rolls back completely when a step fails", async () => {
    const { client, appt } = await seedClient(ws, "Rollback Client", "rollback@t.invalid");
    await db.exec(`create function public.test_fail() returns trigger language plpgsql as $$ begin raise exception 'forced_failure'; end; $$;
      create trigger test_fail before update on public.leads for each row execute function public.test_fail();`);
    try {
      expect(await errOf(anonymize(user(OWNER), ws, client))).toMatch(/forced_failure/);
    } finally {
      await db.exec("drop trigger test_fail on public.leads; drop function public.test_fail();");
    }
    expect((await clientRow(client))).toMatchObject({ name: "Rollback Client", email: "rollback@t.invalid", anonymized_at: null });
    expect((await q("select client_notes from appointments where id=$1", [appt]))[0].client_notes).toContain(PHONE);
    expect((await q("select claimed_by from booking_claims where appointment_id=$1", [appt]))[0].claimed_by).toBe(ACCOUNT_USER);
    expect((await q("select count(*)::int as n from client_erasure_ledger where client_id=$1", [client]))[0].n).toBe(0);
    expect(await anonymize(user(OWNER), ws, client)).toMatchObject({ status: "anonymized" });
  });

  it("locks the client row (parallel calls are serialised; PGlite itself has one connection)", async () => {
    const [def] = await q<{ d: string }>("select pg_get_functiondef('public.anonymize_client_core(uuid,uuid,uuid)'::regprocedure) as d");
    expect(def.d).toMatch(/for update/i);
  });

  it("re-applies recorded erasures after a restore from an older backup", async () => {
    const { client, appt } = await seedClient(ws, "Restore Client", "restore@t.invalid");
    await anonymize(user(OWNER), ws, client);
    const exported = await q("select workspace_id, client_id from client_erasure_ledger where client_id=$1", [client]);
    // Simulate the older backup: personal data back, marker and ledger row gone.
    await q("set session_replication_role = replica");
    await q("update clients set name='Restore Client', email='restore@t.invalid', anonymized_at=null where id=$1", [client]);
    await q("update appointments set internal_notes='Restore Client allergy' where id=$1", [appt]);
    await q("delete from client_erasure_ledger where client_id=$1", [client]);
    await q("set session_replication_role = origin");

    const missing = { workspace_id: ws, client_id: "00000000-0000-4000-8000-000000000000" };
    const [res] = await run<{ r: unknown }>(svc, "select public.reapply_client_erasures($1::jsonb) as r", [JSON.stringify([...exported, missing])]);
    expect(res.r).toEqual({ reapplied: 1, already: 0, missing: 1 });
    expect((await clientRow(client))).toMatchObject({ name: LABEL, email: "" });
    expect((await q("select internal_notes from appointments where id=$1", [appt]))[0].internal_notes).toBe("");
    expect((await q("select count(*)::int as n from client_erasure_ledger where client_id=$1", [client]))[0].n).toBe(1);
    const [again] = await run<{ r: unknown }>(svc, "select public.reapply_client_erasures($1::jsonb) as r", [JSON.stringify(exported)]);
    expect(again.r).toEqual({ reapplied: 0, already: 1, missing: 0 });
  });

  it("security: definer functions pin search_path and are not executable by PUBLIC", async () => {
    const rows = await q<{ proname: string; config: string[] | null; public_exec: boolean; auth_exec: boolean; service_exec: boolean }>(
      `select p.proname, p.proconfig as config,
              has_function_privilege('public', p.oid, 'execute') as public_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
              has_function_privilege('service_role', p.oid, 'execute') as service_exec
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in
          ('anonymize_client','anonymize_client_core','reapply_client_erasures','guard_anonymized_client','guard_no_anonymized_client_ref')`,
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.config).toContain('search_path=""');
      expect(r.public_exec).toBe(false);
    }
    const by = Object.fromEntries(rows.map((r) => [r.proname, r]));
    expect(by.anonymize_client.auth_exec).toBe(true);
    expect(by.anonymize_client_core.auth_exec || by.anonymize_client_core.service_exec).toBe(false);
    expect(by.reapply_client_erasures.auth_exec).toBe(false);
    expect(by.reapply_client_erasures.service_exec).toBe(true);
  });
});
