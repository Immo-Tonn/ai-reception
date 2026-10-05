import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

// The services call createSupabaseServerClient(); point it at a real Postgres (PGlite, every migration)
// acting as whichever user the test selects. `clientCalls` proves the demo gate never reaches the database.
let current: SupabaseClient;
let clientCalls = 0;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    clientCalls += 1;
    return current;
  },
}));

const { getSession } = await import("@/server/auth/session");
const analytics = await import("@/server/services/analytics.service");
const cross = await import("@/server/services/crossModule.service");
const { getAnalyticsOverviewAction } = await import("@/server/actions/analytics.actions");
const { getClientRelatedAction } = await import("@/server/actions/crossModule.actions");
const { PermissionDeniedError } = await import("@/server/permissions/roles");
const { RepositoryForbiddenError, RepositoryNotFoundError } = await import("@/server/repository/errors");
const { toActionError } = await import("@/server/actions/result");
const { ZodError } = await import("zod");

const DAY = "2024-10-11";
let db: PGlite;
let slugA: string, wsA: string, wsB: string;
let owner: string, admin: string, staffU: string, accountant: string, ownerB: string;
let clientX: string, clientB: string, privBucket: string, mainBucket: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const session = async (user: string, slug: string) => (as(user), getSession(slug));

async function user(label: string): Promise<string> {
  const id = randomUUID();
  await db.query("insert into auth.users (id,email) values ($1,$2)", [id, `${label}-${id.slice(0, 6)}@t.invalid`]);
  await db.query("insert into profiles (id,email) values ($1,$2) on conflict do nothing", [id, `${label}-${id.slice(0, 6)}@t.invalid`]);
  return id;
}
async function provision(label: string) {
  const u = await user(label);
  const r = await createPgliteSupabaseClient(db, { kind: "service" }).rpc("provision_workspace", {
    p_user_id: u, p_email: `${label}-${u.slice(0, 6)}@t.invalid`, p_full_name: "", p_business_name: label, p_base_slug: `${label}-${u.slice(0, 6)}`, p_locale: "en",
  });
  const row = (r.data as { out_workspace_id: string; out_slug: string }[])[0];
  return { owner: u, ws: row.out_workspace_id, slug: row.out_slug };
}
const member = async (ws: string, role: string) => {
  const u = await user(role);
  await db.query("insert into workspace_members (workspace_id, profile_id, role) values ($1,$2,$3)", [ws, u, role]);
  return u;
};

beforeAll(async () => {
  db = await createMigratedDb();
  const a = await provision("xa");
  const b = await provision("xb");
  ({ owner, ws: wsA, slug: slugA } = a);
  ({ owner: ownerB, ws: wsB } = b);
  admin = await member(wsA, "admin");
  staffU = await member(wsA, "staff");
  accountant = await member(wsA, "accountant");
  await q("update workspaces set timezone='Europe/Berlin' where id=$1", [wsA]);
  mainBucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [wsA]))[0].id;
  privBucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='private'", [wsA]))[0].id;
  clientX = (await q<{ id: string }>("insert into clients (workspace_id,name) values ($1,'X') returning id", [wsA]))[0].id;
  clientB = (await q<{ id: string }>("insert into clients (workspace_id,name) values ($1,'B') returning id", [wsB]))[0].id;

  // Work for client X: normal / private bucket / owner_only
  await q("insert into leads (workspace_id,client_id,title,stage) values ($1,$2,'Lead normal','new')", [wsA, clientX]);
  await q("insert into leads (workspace_id,client_id,title,stage,financial_bucket_id) values ($1,$2,'Lead private bucket','won',$3)", [wsA, clientX, privBucket]);
  await q("insert into quotes (workspace_id,client_id,title,status,amount,currency) values ($1,$2,'Quote normal','sent',120.5,'EUR')", [wsA, clientX]);
  await q("insert into jobs (workspace_id,client_id,title,status,amount,visibility) values ($1,$2,'Job owner only','done',5,'owner_only')", [wsA, clientX]);
  await q("insert into projects (workspace_id,client_id,title) values ($1,$2,'Project normal')", [wsA, clientX]);
  // A different client's work must not show up
  const other = (await q<{ id: string }>("insert into clients (workspace_id,name) values ($1,'Other') returning id", [wsA]))[0].id;
  await q("insert into leads (workspace_id,client_id,title) values ($1,$2,'Someone else')", [wsA, other]);
  // Invoices for client X
  const inv = async (n: string, o: { bucket?: string; vis?: string; due?: string }) => {
    const id = (await q<{ id: string }>("insert into invoices (workspace_id,client_id,number,financial_bucket_id,visibility,issued_at,due_at,status) values ($1,$2,$3,$4,$5,$6,$7,'sent') returning id",
      [wsA, clientX, n, o.bucket ?? mainBucket, o.vis ?? "normal", DAY, o.due ?? null]))[0].id;
    await q("insert into invoice_items (invoice_id,description,quantity,unit_price) values ($1,'i',1,19.99)", [id]);
  };
  await inv("R1", { due: "2024-10-20" });
  await inv("R2", { bucket: privBucket });
  await inv("R3", { vis: "owner_only" });
}, 120_000);
afterAll(async () => db.close());

describe("analytics service (real workspace)", () => {
  it("owner: mapped DTO with exact minor units, user-scoped client", async () => {
    const s = await session(owner, slugA);
    const o = await analytics.getAnalyticsOverview(s, { from: DAY, to: DAY });
    expect(o.range.timezone).toBe("Europe/Berlin");
    expect(o.permissions).toEqual({ appointments: true, clients: true, finance: true, privateBucket: true });
    expect(o.finance?.invoices.find((r) => r.status === "overdue")).toMatchObject({ currency: "EUR", count: 1, minor: 1999 }); // R1
    expect(o.finance?.invoices.find((r) => r.status === "sent")).toMatchObject({ count: 2, minor: 3998 }); // R2 + R3
    expect(o.work?.quotes).toEqual([{ status: "sent", currency: "EUR", count: 1, minor: 12050 }]);
  });
  it("admin: finance numbers are only the visible subset; the private-bucket line is not offered", async () => {
    const o = await analytics.getAnalyticsOverview(await session(admin, slugA), { from: DAY, to: DAY });
    expect(o.permissions.privateBucket).toBe(false);
    expect(o.finance?.invoices).toEqual([{ status: "overdue", currency: "EUR", count: 1, minor: 1999 }]);
  });
  it("staff: no finance section at all in the DTO sent to the browser", async () => {
    const o = await analytics.getAnalyticsOverview(await session(staffU, slugA), { from: DAY, to: DAY });
    expect(o.finance).toBeUndefined();
    expect(o.appointments).toBeDefined();
    expect(JSON.stringify(o)).not.toMatch(/overdue|revenue|1999/);
  });
  it("accountant: finance only", async () => {
    const o = await analytics.getAnalyticsOverview(await session(accountant, slugA), { from: DAY, to: DAY });
    expect(o.appointments).toBeUndefined();
    expect(o.newClients).toBeUndefined();
    expect(o.finance).toBeDefined();
  });
  it("validates the range with zod (ActionResult carries invalid_input)", async () => {
    const s = await session(owner, slugA);
    await expect(analytics.getAnalyticsOverview(s, { from: "2024-10-12", to: DAY })).rejects.toBeInstanceOf(ZodError);
    await expect(analytics.getAnalyticsOverview(s, { from: "2024-02-30", to: "2024-03-01" })).rejects.toBeInstanceOf(ZodError);
    await expect(analytics.getAnalyticsOverview(s, { from: "2020-01-01", to: "2024-10-11" })).rejects.toBeInstanceOf(ZodError);
    as(owner);
    expect(await getAnalyticsOverviewAction(slugA, { from: "x", to: "y" })).toEqual({ ok: false, code: "invalid_input" });
    expect(await getAnalyticsOverviewAction(slugA, { from: DAY, to: DAY })).toMatchObject({ ok: true });
  });
  it("a forged workspace id is forbidden by the database even with a hand-made session", async () => {
    as(ownerB);
    await expect(analytics.getAnalyticsOverview({ userId: ownerB, workspaceId: wsA, role: "owner" }, { from: DAY, to: DAY })).rejects.toBeInstanceOf(RepositoryForbiddenError);
  });
  it("a non-member cannot even resolve the session (action answers forbidden)", async () => {
    as(ownerB);
    expect(await getAnalyticsOverviewAction(slugA, { from: DAY, to: DAY })).toEqual({ ok: false, code: "forbidden" });
  });
  it("DEMO GATE: demo workspaces never call the database or the RPC", async () => {
    clientCalls = 0;
    await expect(
      analytics.getAnalyticsOverview({ userId: "demo-user", workspaceId: "demo-salon", role: "owner" }, { from: DAY, to: DAY }),
    ).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(clientCalls).toBe(0);
  });
  it("DEMO GATE (UI): the page picks the demo view for demo slugs and the demo view never imports the real action", () => {
    const dir = path.resolve(__dirname, "../../../app/(app)/[workspaceSlug]/analytics");
    const page = readFileSync(path.join(dir, "page.tsx"), "utf8");
    const demoView = readFileSync(path.join(dir, "AnalyticsView.tsx"), "utf8");
    expect(page).toMatch(/isDemoWorkspaceSlug\(workspaceSlug\)/);
    expect(demoView).toMatch(/computeAnalytics/);
    expect(demoView).not.toMatch(/analytics\.actions|analytics_overview|server\//);
  });
});

describe("cross-module relations (client detail 'Related' panel)", () => {
  const titles = (items?: { title: string }[]) => (items ?? []).map((i) => i.title).sort();

  it("owner sees every related row of the client (and none of other clients')", async () => {
    const r = await cross.getClientRelated(await session(owner, slugA), clientX);
    expect(titles(r.work?.leads)).toEqual(["Lead normal", "Lead private bucket"]);
    expect(r.work?.quotes).toEqual([expect.objectContaining({ title: "Quote normal", status: "sent", amountMinor: 12050, currency: "EUR" })]);
    expect(titles(r.work?.jobs)).toEqual(["Job owner only"]);
    expect(titles(r.work?.projects)).toEqual(["Project normal"]);
    expect(r.invoices?.map((i) => i.number).sort()).toEqual(["R1", "R2", "R3"]);
    expect(r.invoices?.find((i) => i.number === "R1")).toMatchObject({ status: "overdue", amountMinor: 1999 });
  });
  it("admin: only what RLS allows (no private bucket / owner_only rows)", async () => {
    const r = await cross.getClientRelated(await session(admin, slugA), clientX);
    expect(titles(r.work?.leads)).toEqual(["Lead normal"]);
    expect(titles(r.work?.jobs)).toEqual([]);
    expect(r.invoices?.map((i) => i.number)).toEqual(["R1"]);
  });
  it("staff (clients.view, no finance.view): work yes, the invoices section is absent", async () => {
    const r = await cross.getClientRelated(await session(staffU, slugA), clientX);
    expect(r.work).toBeDefined();
    expect(r.invoices).toBeUndefined();
    expect(JSON.stringify(r)).not.toMatch(/R1|1999/);
  });
  it("accountant (no clients.view): refused, no data", async () => {
    const s = await session(accountant, slugA);
    await expect(cross.getClientRelated(s, clientX)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await getClientRelatedAction(slugA, clientX)).toEqual({ ok: false, code: "forbidden" });
  });
  it("a client of another workspace (forged id) is not found; B's owner cannot read A's client either", async () => {
    await expect(cross.getClientRelated(await session(owner, slugA), clientB)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    as(ownerB);
    await expect(cross.getClientRelated({ userId: ownerB, workspaceId: wsB, role: "owner" }, clientX)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(toActionError(new RepositoryNotFoundError("x"))).toBe("not_found");
  });
  it("demo workspaces and malformed ids return nothing without touching the database", async () => {
    clientCalls = 0;
    expect(await cross.getClientRelated({ userId: "demo-user", workspaceId: "demo-salon", role: "owner" }, clientX)).toEqual({});
    expect(await cross.getClientRelated({ userId: owner, workspaceId: wsA, role: "owner" }, "not-a-uuid")).toEqual({});
    expect(clientCalls).toBe(0);
  });
  it("cross-workspace references are rejected by the database (FK guards)", async () => {
    const bad = async (sql: string, p: unknown[]) => {
      try {
        await db.query(sql, p);
        return "ok";
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };
    expect(await bad("insert into quotes (workspace_id,client_id,title) values ($1,$2,'x')", [wsA, clientB])).toBe("23514");
    expect(await bad("insert into jobs (workspace_id,client_id,title) values ($1,$2,'x')", [wsA, clientB])).toBe("23514");
    expect(await bad("insert into leads (workspace_id,client_id,title) values ($1,$2,'x')", [wsA, clientB])).toBe("23514");
    expect(await bad("insert into invoices (workspace_id,client_id,number) values ($1,$2,'BAD-1')", [wsA, clientB])).toBe("23514");
    expect(await bad("insert into projects (workspace_id,client_id,title) values ($1,$2,'x')", [wsA, clientB])).toBe("23514");
  });
});
