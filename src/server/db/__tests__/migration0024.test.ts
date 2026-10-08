import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "./pg";
import { createPgliteSupabaseClient } from "./supabasePglite";

/**
 * Migration 0024 (analytics_overview) against a REAL PostgreSQL (PGlite, every migration replayed):
 * hand-computed aggregates, workspace-local day boundaries, exact decimal money per currency, and the
 * financial privacy contract (SECURITY INVOKER => RLS decides every aggregated row).
 *
 * The range is a day in 2024 (Berlin is UTC+2 then): the seeded rows sit right around local midnight so
 * the UTC date and the Berlin date differ, and "today" (real clock) is long after every due date.
 */

const DAY = "2024-10-11";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

let db: PGlite;
let ws: string;
let owner: string, admin: string, manager: string, staffUser: string, accountant: string, outsider: string;
let wsB: string, ownerB: string;
let mainBucket: string, privBucket: string;
let svcCut: string, svcColor: string, s1: string, s2: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const asUser = (id: string) => createPgliteSupabaseClient(db, { kind: "user", id });
const call = (client: ReturnType<typeof asUser>, workspace: string, from = DAY, to = DAY) =>
  client.rpc("analytics_overview", { p_workspace_id: workspace, p_from: from, p_to: to });
const overview = async (user: string, workspace = ws, from = DAY, to = DAY): Promise<Json> => {
  const r = await call(asUser(user), workspace, from, to);
  expect(r.error).toBeNull();
  return r.data as Json;
};

async function newUser(label: string): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${label}-${id.slice(0, 6)}@t.invalid`]);
  await db.query("insert into profiles (id, email) values ($1, $2) on conflict do nothing", [id, `${label}-${id.slice(0, 6)}@t.invalid`]);
  return id;
}
async function provision(label: string): Promise<{ ws: string; owner: string }> {
  const u = await newUser(label);
  const email = (await q<{ email: string }>("select email from auth.users where id=$1", [u]))[0].email;
  const r = await createPgliteSupabaseClient(db, { kind: "service" }).rpc("provision_workspace", {
    p_user_id: u, p_email: email, p_full_name: "", p_business_name: label, p_base_slug: `${label}-${u.slice(0, 6)}`, p_locale: "en",
  });
  return { ws: (r.data as { out_workspace_id: string }[])[0].out_workspace_id, owner: u };
}
async function member(workspace: string, role: string): Promise<string> {
  const u = await newUser(role);
  await db.query("insert into workspace_members (workspace_id, profile_id, role) values ($1,$2,$3)", [workspace, u, role]);
  return u;
}

const appt = (o: { start: string; minutes: number; status: string; staff: string | null; service: string | null; vis?: string }) =>
  q(
    `insert into appointments (workspace_id, service_id, staff_id, starts_at, ends_at, status, visibility)
     values ($1,$2,$3,$4::timestamptz,$4::timestamptz + make_interval(mins => $5::int),$6,$7)`,
    [ws, o.service, o.staff, o.start, o.minutes, o.status, o.vis ?? "normal"],
  );

async function invoice(o: {
  number: string; currency?: string; bucket?: string; vis?: string; issued: string; due?: string | null;
  items: [number, number][]; payments?: { amount: number; at: string; voided?: boolean }[]; status?: string;
}): Promise<string> {
  const id = (
    await q<{ id: string }>(
      `insert into invoices (workspace_id, number, currency, financial_bucket_id, visibility, issued_at, due_at, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [ws, o.number, o.currency ?? "EUR", o.bucket ?? mainBucket, o.vis ?? "normal", o.issued, o.due ?? null, o.status ?? "sent"],
    )
  )[0].id;
  for (const [qty, price] of o.items) {
    await q("insert into invoice_items (invoice_id, description, quantity, unit_price) values ($1,'x',$2,$3)", [id, qty, price]);
  }
  for (const p of o.payments ?? []) {
    const pid = (
      await q<{ id: string }>(
        "insert into payments (workspace_id, invoice_id, amount, paid_at) values ($1,$2,$3,$4::timestamptz) returning id",
        [ws, id, p.amount, p.at],
      )
    )[0].id;
    if (p.voided) await q("update payments set voided_at = now() where id = $1", [pid]);
  }
  return id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  const a = await provision("biz-a");
  ws = a.ws;
  owner = a.owner;
  const b = await provision("biz-b");
  wsB = b.ws;
  ownerB = b.owner;
  admin = await member(ws, "admin");
  manager = await member(ws, "manager");
  staffUser = await member(ws, "staff");
  accountant = await member(ws, "accountant");
  outsider = await newUser("outsider");
  await q("update workspaces set timezone = 'Europe/Berlin' where id = $1", [ws]);

  mainBucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [ws]))[0].id;
  privBucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='private'", [ws]))[0].id;
  await q("update staff_profiles set active = false where workspace_id = $1", [ws]); // the owner's own "You"
  s1 = (await q<{ id: string }>("insert into staff_profiles (workspace_id, name, active) values ($1,'Anna',true) returning id", [ws]))[0].id;
  s2 = (await q<{ id: string }>("insert into staff_profiles (workspace_id, name, active) values ($1,'Boris',false) returning id", [ws]))[0].id;
  svcCut = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Cut',30,10) returning id", [ws]))[0].id;
  svcColor = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Color',60,10) returning id", [ws]))[0].id;

  // Appointments (Berlin = UTC+2 on 2024-10-11). a1 is 00:30 on the 11th LOCAL but the 10th in UTC.
  await appt({ start: "2024-10-10T22:30:00Z", minutes: 30, status: "confirmed", staff: s1, service: svcCut }); // a1 in (local 11th)
  await appt({ start: "2024-10-11T09:00:00Z", minutes: 60, status: "completed", staff: s1, service: svcColor }); // a2
  await appt({ start: "2024-10-11T10:30:00Z", minutes: 45, status: "completed", staff: s2, service: svcCut }); // a3
  await appt({ start: "2024-10-11T12:00:00Z", minutes: 30, status: "cancelled", staff: s1, service: svcCut }); // a4
  await appt({ start: "2024-10-11T13:00:00Z", minutes: 30, status: "no_show", staff: s2, service: svcColor }); // a5
  await appt({ start: "2024-10-11T14:00:00Z", minutes: 30, status: "pending", staff: s1, service: svcCut, vis: "private" }); // a6
  await appt({ start: "2024-10-11T15:00:00Z", minutes: 30, status: "confirmed", staff: s2, service: svcCut, vis: "owner_only" }); // a7
  await appt({ start: "2024-10-11T22:30:00Z", minutes: 30, status: "confirmed", staff: s1, service: svcCut }); // out: local 12th 00:30 (UTC 11th)
  await appt({ start: "2024-10-10T21:30:00Z", minutes: 30, status: "confirmed", staff: s1, service: svcCut }); // out: local 10th 23:30

  // Clients created around local midnight.
  for (const [n, at] of [["c1", "2024-10-10T22:30:00Z"], ["c2", "2024-10-11T22:30:00Z"], ["c3", "2024-10-11T12:00:00Z"]]) {
    await q("insert into clients (workspace_id, name, created_at) values ($1,$2,$3::timestamptz)", [ws, n, at]);
  }

  // Invoices / payments.
  await invoice({ number: "I1", issued: DAY, due: "2999-12-31", items: [[3, 19.99], [1.5, 33.33]], // 59.97 + 50.00 (49.995 half-up) = 109.97
    payments: [{ amount: 40.1, at: "2024-10-11T10:00:00Z" }, { amount: 20, at: "2024-10-10T22:30:00Z" }] });
  await invoice({ number: "I2", issued: DAY, vis: "private", items: [[1, 100]], payments: [{ amount: 100, at: "2024-10-11T11:00:00Z" }] });
  await invoice({ number: "I3", issued: DAY, bucket: privBucket, items: [[1, 250.5]], payments: [{ amount: 250.5, at: "2024-10-11T12:00:00Z" }] });
  await invoice({ number: "I4", issued: DAY, currency: "USD", due: "2024-10-20", items: [[1, 80]], payments: [{ amount: 30, at: "2024-10-11T09:30:00Z" }] });
  await invoice({ number: "I5", issued: DAY, items: [[1, 10]], payments: [{ amount: 10, at: "2024-10-11T08:00:00Z", voided: true }] });
  await invoice({ number: "I6", issued: DAY, vis: "owner_only", items: [[1, 7.77]], payments: [{ amount: 7.77, at: "2024-10-11T08:30:00Z" }] });
  await invoice({ number: "I7", issued: "2024-10-09", items: [[1, 15]], payments: [{ amount: 15, at: "2024-10-11T23:30:00Z" }] }); // paid at local 12th 01:30
  await invoice({ number: "I8", issued: DAY, bucket: privBucket, items: [[1, 33]] });

  // Work pipeline (superuser inserts; the default bucket trigger fills "main").
  const lead = (title: string, stage: string, o: { bucket?: string; vis?: string; archived?: boolean } = {}) =>
    q("insert into leads (workspace_id,title,stage,financial_bucket_id,visibility,archived) values ($1,$2,$3,$4,$5,$6)",
      [ws, title, stage, o.bucket ?? null, o.vis ?? "normal", o.archived ?? false]);
  await lead("L1", "new");
  await lead("L2", "won");
  await lead("L3", "lost", { bucket: privBucket });
  await lead("L4", "new", { archived: true });
  const quote = async (title: string, status: string, amount: number, currency: string, o: { bucket?: string } = {}) =>
    (await q<{ id: string }>("insert into quotes (workspace_id,title,status,amount,currency,financial_bucket_id) values ($1,$2,$3,$4,$5,$6) returning id",
      [ws, title, status, amount, currency, o.bucket ?? null]))[0].id;
  await quote("Q1", "draft", 100.5, "EUR");
  const q2 = await quote("Q2", "accepted", 200.25, "EUR");
  await quote("Q3", "sent", 50, "USD");
  await quote("Q4", "draft", 999.99, "EUR", { bucket: privBucket });
  await q("insert into jobs (workspace_id,title,status,amount,currency,quote_id) values ($1,'J1','scheduled',200.25,'EUR',$2)", [ws, q2]);
  await q("insert into jobs (workspace_id,title,status,amount,currency,visibility) values ($1,'J2','done',11.11,'EUR','owner_only')", [ws]);
  await q("insert into projects (workspace_id,title,status) values ($1,'P1','active')", [ws]);
  await q("insert into projects (workspace_id,title,status,visibility) values ($1,'P2','done','private')", [ws]);
}, 120_000);
afterAll(async () => db.close());

const find = (rows: Json[], pred: (r: Json) => boolean) => rows.find(pred);

describe("0024 appointments, clients, services, staff (hand-computed, Berlin day)", () => {
  it("owner: counts by status over the LOCAL day, UTC-day neighbours excluded", async () => {
    const o = await overview(owner);
    expect(o.range).toMatchObject({ from: DAY, to: DAY, timezone: "Europe/Berlin" });
    expect(o.appointments.total).toBe(7);
    expect(o.appointments.by_status).toMatchObject({ pending: 1, confirmed: 2, completed: 2, cancelled: 1, no_show: 1, checked_in: 0, in_progress: 0, rescheduled: 0 });
  });
  it("a UTC-day query would differ: the same appointments are NOT assigned by UTC date", async () => {
    // Berlin 2024-10-12 contains only the 22:30Z appointment of the 11th; UTC-date 12th would contain none.
    const o = await overview(owner, ws, "2024-10-12", "2024-10-12");
    expect(o.appointments.total).toBe(1);
    expect(o.appointments.by_status.confirmed).toBe(1);
  });
  it("owner: services popularity and staff workload (inactive staff keep their name)", async () => {
    const o = await overview(owner);
    expect(o.appointments.services).toEqual([
      { service_id: svcCut, name: "Cut", count: 4 }, // a1 a3 a6 a7 (a4 cancelled)
      { service_id: svcColor, name: "Color", count: 2 }, // a2 a5
    ]);
    expect(o.appointments.staff).toEqual([
      { staff_id: s1, name: "Anna", active: true, count: 3, minutes: 120 }, // a1 30 + a2 60 + a6 30
      { staff_id: s2, name: "Boris", active: false, count: 3, minutes: 105 }, // a3 45 + a5 30 + a7 30
    ]);
  });
  it("new clients are counted per local day of created_at", async () => {
    expect((await overview(owner)).clients.new).toBe(2); // c1 (local 11th 00:30) and c3; c2 is local 12th
    expect((await overview(owner, ws, "2024-10-12", "2024-10-12")).clients.new).toBe(1);
  });
  it("admin sees the same minus private / owner_only rows (RLS), and the numbers are the visible subset", async () => {
    const a = await overview(admin);
    expect(a.appointments.total).toBe(5);
    expect(a.appointments.by_status).toMatchObject({ pending: 0, confirmed: 1, completed: 2, cancelled: 1, no_show: 1 });
    expect(a.appointments.services).toEqual([
      { service_id: svcColor, name: "Color", count: 2 },
      { service_id: svcCut, name: "Cut", count: 2 },
    ]);
    expect(a.appointments.staff.map((s: Json) => [s.name, s.count, s.minutes])).toEqual([["Anna", 2, 90], ["Boris", 2, 75]]);
  });
  it("an empty range returns zero-filled counters, not an error", async () => {
    const o = await overview(owner, ws, "2023-01-01", "2023-01-02");
    expect(o.appointments.total).toBe(0);
    expect(o.appointments.services).toEqual([]);
    expect(o.finance.revenue).toEqual([]);
  });
  it("rejects an invalid range", async () => {
    for (const [f, t] of [["2024-10-12", "2024-10-11"], ["2022-01-01", "2024-10-11"]]) {
      const r = await call(asUser(owner), ws, f, t);
      expect(r.error?.code).toBe("22023");
    }
  });
});

describe("0024 finance: revenue = non-voided payments by local paid_at, exact decimals, currencies apart", () => {
  it("owner: per currency and bucket kind", async () => {
    const f = (await overview(owner)).finance;
    // I1 40.10 + 20.00 (the 20.00 was paid 2024-10-10T22:30Z = local 11th), I2 100.00, I6 7.77. I5 voided, I7 paid local 12th.
    expect(find(f.revenue, (r) => r.currency === "EUR" && r.bucket === "main")).toMatchObject({ total: "167.87", payments: 4 });
    expect(find(f.revenue, (r) => r.currency === "EUR" && r.bucket === "private")).toMatchObject({ total: "250.50", payments: 1 });
    expect(find(f.revenue, (r) => r.currency === "USD")).toMatchObject({ bucket: "main", total: "30.00", payments: 1 });
    expect(f.revenue).toHaveLength(3); // currencies never merged
  });
  it("the payment of I7 lands on the next local day", async () => {
    const f = (await overview(owner, ws, "2024-10-12", "2024-10-12")).finance;
    expect(f.revenue).toEqual([{ currency: "EUR", bucket: "main", total: "15.00", payments: 1 }]);
  });
  it("invoices issued in the range by effective status (overdue derived) and currency", async () => {
    const f = (await overview(owner)).finance;
    expect(f.invoices).toEqual([
      { status: "overdue", currency: "USD", count: 1, total: "80.00" },
      { status: "paid", currency: "EUR", count: 3, total: "358.27" }, // I2 100 + I3 250.50 + I6 7.77
      { status: "partially_paid", currency: "EUR", count: 1, total: "109.97" }, // 3 x 19.99 + round(1.5 x 33.33)
      { status: "sent", currency: "EUR", count: 2, total: "43.00" }, // I5 10 + I8 33
    ]);
  });
  it("outstanding = open balance of sent / partially paid invoices (any issue date), per currency", async () => {
    const f = (await overview(owner)).finance;
    expect(f.outstanding).toEqual([
      { currency: "EUR", total: "92.87", invoices: 3, overdue: 0 }, // 49.87 + 10.00 + 33.00
      { currency: "USD", total: "50.00", invoices: 1, overdue: 1 },
    ]);
  });
});

describe("0024 FINANCIAL PRIVACY (SECURITY INVOKER: RLS decides every aggregated row)", () => {
  it("admin: no private bucket, no private / owner_only invoices; totals = the visible subset", async () => {
    const o = await overview(admin);
    expect(o.permissions).toEqual({ appointments: true, clients: true, finance: true });
    const f = o.finance;
    expect(find(f.revenue, (r) => r.bucket === "private")).toBeUndefined();
    expect(find(f.revenue, (r) => r.currency === "EUR")).toMatchObject({ bucket: "main", total: "60.10", payments: 2 }); // I1 only (I2 private, I6 owner_only hidden)
    expect(f.revenue).toHaveLength(2);
    expect(f.invoices).toEqual([
      { status: "overdue", currency: "USD", count: 1, total: "80.00" },
      { status: "partially_paid", currency: "EUR", count: 1, total: "109.97" },
      { status: "sent", currency: "EUR", count: 1, total: "10.00" }, // I8 (private bucket) not counted
    ]);
    expect(f.outstanding).toEqual([
      { currency: "EUR", total: "59.87", invoices: 2, overdue: 0 },
      { currency: "USD", total: "50.00", invoices: 1, overdue: 1 },
    ]);
  });
  it("the owner's totals differ from the admin's (they include everything the admin may not see)", async () => {
    const ownerRev = (await overview(owner)).finance.revenue as Json[];
    const adminRev = (await overview(admin)).finance.revenue as Json[];
    const sum = (rows: Json[], cur: string) => rows.filter((r) => r.currency === cur).reduce((n, r) => n + Math.round(parseFloat(r.total) * 100), 0);
    expect(sum(ownerRev, "EUR")).toBe(41837);
    expect(sum(adminRev, "EUR")).toBe(6010);
    expect(sum(ownerRev, "EUR")).not.toBe(sum(adminRev, "EUR"));
  });
  it("accountant: finance only (private bucket yes, private visibility no); no appointment / client / work numbers at all", async () => {
    const o = await overview(accountant);
    expect(o.permissions).toEqual({ appointments: false, clients: false, finance: true });
    expect(o.appointments).toBeUndefined();
    expect(o.clients).toBeUndefined();
    expect(o.work).toBeUndefined();
    expect(find(o.finance.revenue, (r) => r.bucket === "private")).toMatchObject({ total: "250.50" }); // I3
    expect(find(o.finance.revenue, (r) => r.currency === "EUR" && r.bucket === "main")).toMatchObject({ total: "60.10" }); // I2 / I6 hidden by visibility
    expect(o.finance.outstanding).toContainEqual({ currency: "EUR", total: "92.87", invoices: 3, overdue: 0 });
  });
  it("manager and staff: the revenue keys are ABSENT, counts present", async () => {
    for (const u of [manager, staffUser]) {
      const o = await overview(u);
      expect(o.finance).toBeUndefined();
      expect(o.permissions.finance).toBe(false);
      expect(o.appointments.total).toBe(5);
      expect(JSON.stringify(o)).not.toMatch(/250\.50|167\.87|revenue/);
    }
  });
  it("work pipeline: the caller's rows only (private bucket / private / owner_only work hidden from admin)", async () => {
    const own = (await overview(owner)).work;
    expect(own.leads).toEqual([{ stage: "lost", count: 1 }, { stage: "new", count: 1 }, { stage: "won", count: 1 }]); // archived L4 excluded
    expect(own.quotes).toEqual([
      { status: "accepted", currency: "EUR", count: 1, total: "200.25" },
      { status: "draft", currency: "EUR", count: 2, total: "1100.49" },
      { status: "sent", currency: "USD", count: 1, total: "50.00" },
    ]);
    expect(own.jobs).toEqual([
      { status: "done", currency: "EUR", count: 1, total: "11.11" },
      { status: "scheduled", currency: "EUR", count: 1, total: "200.25" },
    ]);
    expect(own.projects).toEqual([{ status: "active", count: 1 }, { status: "done", count: 1 }]);

    const adm = (await overview(admin)).work;
    expect(adm.leads).toEqual([{ stage: "new", count: 1 }, { stage: "won", count: 1 }]);
    expect(adm.quotes).toEqual([
      { status: "accepted", currency: "EUR", count: 1, total: "200.25" },
      { status: "draft", currency: "EUR", count: 1, total: "100.50" },
      { status: "sent", currency: "USD", count: 1, total: "50.00" },
    ]);
    expect(adm.jobs).toEqual([{ status: "scheduled", currency: "EUR", count: 1, total: "200.25" }]);
    expect(adm.projects).toEqual([{ status: "active", count: 1 }]);
  });
});

describe("0024 tenant isolation and access", () => {
  it("workspace B's owner cannot aggregate A's data (forged workspace id => forbidden)", async () => {
    const r = await call(asUser(ownerB), ws);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe("42501");
  });
  it("a signed-in user without membership gets nothing, same answer as for a non-existing workspace", async () => {
    const r1 = await call(asUser(outsider), ws);
    const r2 = await call(asUser(outsider), randomUUID());
    expect(r1.error?.code).toBe("42501");
    expect(r2.error?.code).toBe("42501");
    expect(r1.error?.message).toBe(r2.error?.message);
  });
  it("anon cannot call the function", async () => {
    const r = await call(createPgliteSupabaseClient(db, { kind: "anon" }) as unknown as ReturnType<typeof asUser>, ws);
    expect(r.data).toBeNull();
    expect(r.error?.code).toBe("42501");
  });
  it("B sees only B's own (empty) numbers for its own workspace", async () => {
    const o = await overview(ownerB, wsB);
    expect(o.appointments.total).toBe(0);
    expect(o.finance.revenue).toEqual([]);
    expect(o.work.quotes).toEqual([]);
  });
  it("is SECURITY INVOKER, stable, search_path pinned, execute only for authenticated / service_role", async () => {
    const f = (await q<{ prosecdef: boolean; provolatile: string; proconfig: string[] | null }>(
      "select prosecdef, provolatile, proconfig from pg_proc where proname = 'analytics_overview'"))[0];
    expect(f.prosecdef).toBe(false);
    expect(f.provolatile).toBe("s");
    expect(f.proconfig).toContain("search_path=\"\"");
    const grants = await q<{ r: string }>(
      `select r.rolname as r from pg_roles r where has_function_privilege(r.rolname, 'public.analytics_overview(uuid,date,date)', 'execute') and r.rolname in ('anon','authenticated','service_role')`);
    expect(grants.map((g) => g.r).sort()).toEqual(["authenticated", "service_role"]);
  });
});

describe("0024 end to end: Lead -> Quote -> Job -> Invoice -> payment is reflected in analytics", () => {
  it("every step moves the right number", async () => {
    const b = await provision("flow");
    const flowWs = b.ws;
    const me = asUser(b.owner);
    await q("update workspaces set timezone = 'Europe/Berlin' where id = $1", [flowWs]);
    const today = (await q<{ d: string }>("select (now() at time zone 'Europe/Berlin')::date::text as d"))[0].d;
    const ov = async () => (await call(me, flowWs, today, today)).data as Json;

    const lead = (await q<{ id: string }>("insert into leads (workspace_id,title,stage,estimated_value,created_by) values ($1,'Kitchen','new',500,$2) returning id", [flowWs, b.owner]))[0].id;
    expect((await ov()).work.leads).toEqual([{ stage: "new", count: 1 }]);

    const quoteId = ((await me.rpc("convert_lead_to_quote", { p_lead_id: lead })).data as { out_quote_id: string }[])[0].out_quote_id;
    await q("update quotes set amount = 480.00 where id = $1", [quoteId]);
    let o = await ov();
    expect(o.work.leads).toEqual([{ stage: "quoted", count: 1 }]);
    expect(o.work.quotes).toEqual([{ status: "draft", currency: "EUR", count: 1, total: "480.00" }]);

    const jobId = ((await me.rpc("accept_quote_create_job", { p_quote_id: quoteId })).data as { out_job_id: string }[])[0].out_job_id;
    o = await ov();
    expect(o.work.leads).toEqual([{ stage: "won", count: 1 }]);
    expect(o.work.quotes[0]).toMatchObject({ status: "accepted", total: "480.00" });
    expect(o.work.jobs).toEqual([{ status: "scheduled", currency: "EUR", count: 1, total: "480.00" }]);

    const invoiceId = (
      await me.rpc("create_invoice", { p_workspace_id: flowWs, p_items: [{ description: "Kitchen", quantity: 1, unit_price: 480 }], p_status: "sent" })
    ).data as string;
    await q("update invoices set job_id = $1, quote_id = $2 where id = $3", [jobId, quoteId, invoiceId]);
    o = await ov();
    expect(o.finance.invoices).toEqual([{ status: "sent", currency: "EUR", count: 1, total: "480.00" }]);
    expect(o.finance.outstanding).toEqual([{ currency: "EUR", total: "480.00", invoices: 1, overdue: 0 }]);
    expect(o.finance.revenue).toEqual([]);

    await me.rpc("record_payment", { p_invoice_id: invoiceId, p_amount: 100.25, p_method: "cash" });
    o = await ov();
    expect(o.finance.revenue).toEqual([{ currency: "EUR", bucket: "main", total: "100.25", payments: 1 }]);
    expect(o.finance.invoices).toEqual([{ status: "partially_paid", currency: "EUR", count: 1, total: "480.00" }]);
    expect(o.finance.outstanding[0]).toMatchObject({ total: "379.75" });

    await me.rpc("record_payment", { p_invoice_id: invoiceId, p_amount: 379.75, p_method: "bank_transfer" });
    o = await ov();
    expect(o.finance.revenue).toEqual([{ currency: "EUR", bucket: "main", total: "480.00", payments: 2 }]);
    expect(o.finance.invoices).toEqual([{ status: "paid", currency: "EUR", count: 1, total: "480.00" }]);
    expect(o.finance.outstanding).toEqual([]);
  });
});
