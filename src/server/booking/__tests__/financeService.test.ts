import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

// Real PostgreSQL (PGlite, all migrations) behind the real finance service + repository, acting as whichever user the test selects.
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const finance = await import("@/server/services/finance.service");
const { PermissionDeniedError } = await import("@/server/permissions/roles");
const { RepositoryConflictError, RepositoryForbiddenError, RepositoryNotFoundError } = await import("@/server/repository/errors");
const { createSupabaseInvoicesRepository } = await import("@/server/repository/invoicesSupabaseRepository");
const { getServerInvoicesRepository } = await import("@/server/repository/registry");
const { toActionError } = await import("@/server/actions/result");
const { ZodError } = await import("zod");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ADMIN = "aaaaaaaa-0000-4000-8000-0000000000a2";
const MANAGER = "aaaaaaaa-0000-4000-8000-0000000000a3";
const STAFF = "aaaaaaaa-0000-4000-8000-0000000000a4";
const ACCOUNTANT = "aaaaaaaa-0000-4000-8000-0000000000a5";
const OTHER = "bbbbbbbb-0000-4000-8000-0000000000b1";

let db: PGlite;
let slug: string, wsId: string, otherSlug: string, otherWs: string;
let clientA: string, clientB: string, apptB: string;
let customA2: string, customB: string, mainA: string;

const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const sessionOf = async (id: string, s = slug) => (as(id), getSession(s));
const auditRows = (invoiceId: string) =>
  q<{ action: string; summary: string; entity_type: string; source: string }>("select action, summary, entity_type, source from audit_logs where entity_id=$1 order by created_at, id", [invoiceId]);
const item = (description: string, quantity: number, unitPrice: number) => ({ description, quantity, unitPrice });
const base = { bucket: "main" as const, visibility: "normal" as const };

beforeAll(async () => {
  db = await createMigratedDb();
  const emails: Record<string, string> = { [OWNER]: "o", [ADMIN]: "ad", [MANAGER]: "m", [STAFF]: "s", [ACCOUNTANT]: "ac", [OTHER]: "x" };
  for (const [id, e] of Object.entries(emails)) await db.query("insert into auth.users (id,email) values ($1,$2)", [id, `${e}@test.invalid`]);
  const svc = createPgliteSupabaseClient(db, { kind: "service" });
  const prov = async (user: string, name: string, base: string) =>
    ((await svc.rpc("provision_workspace", { p_user_id: user, p_email: `${emails[user]}@test.invalid`, p_full_name: "", p_business_name: name, p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[])[0];
  const a = await prov(OWNER, "Fin A", "fin-svc-a");
  wsId = a.out_workspace_id;
  slug = a.out_slug;
  const b = await prov(OTHER, "Fin B", "fin-svc-b");
  otherWs = b.out_workspace_id;
  otherSlug = b.out_slug;
  for (const [uid, role] of [[ADMIN, "admin"], [MANAGER, "manager"], [STAFF, "staff"], [ACCOUNTANT, "accountant"]] as const) {
    await q("insert into profiles (id,email) values ($1,$2) on conflict do nothing", [uid, `${emails[uid]}@test.invalid`]);
    await q("insert into workspace_members (workspace_id,profile_id,role) values ($1,$2,$3)", [wsId, uid, role]);
  }
  clientA = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Anna Müller','anna@example.test') returning id", [wsId]))[0].id;
  clientB = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Bob Other','bob@example.test') returning id", [otherWs]))[0].id;
  const staffB = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [otherWs]))[0].id;
  apptB = (await q<{ id: string }>("insert into appointments (workspace_id,staff_id,client_id,starts_at,ends_at) values ($1,$2,$3,now()+interval '9 day',now()+interval '9 day 1 hour') returning id", [otherWs, staffB, clientB]))[0].id;
  mainA = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [wsId]))[0].id;
  // a SECOND custom bucket (newer): a plain edit must keep THIS id, not fall back to the first custom bucket
  customA2 = (await q<{ id: string }>("insert into financial_buckets (workspace_id,name,slug,kind) values ($1,'Side 2','side2','custom') returning id", [wsId]))[0].id;
  customB = (await q<{ id: string }>("insert into financial_buckets (workspace_id,name,slug,kind) values ($1,'SideB','side','custom') returning id", [otherWs]))[0].id;
}, 120_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("create / pay / cancel through the real service", () => {
  it("creates an invoice with a database number, line items, workspace-local date and ONE audit entry without PII", async () => {
    const s = await sessionOf(OWNER);
    const inv = await finance.createInvoice(s, { ...base, client: "", clientId: clientA, items: [item("Cut", 1, 40), item("Color", 2, 45.5)], dueDate: null, notes: "thanks" });
    expect(inv.number).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(inv).toMatchObject({ status: "unpaid", amount: 131, client: "Anna Müller", clientId: clientA, bucket: "main", visibility: "normal" });
    expect(inv.items).toHaveLength(2);
    expect(inv.items?.map((i) => i.description)).toEqual(["Cut", "Color"]);
    const audit = await auditRows(inv.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "created", entity_type: "invoice", source: "user", summary: `${inv.number}: created` });
    expect(audit[0].summary).not.toMatch(/Anna|anna|131|example/);
  });

  it("money exactness through the service: 0.10 + 0.20 = 0.30, qty 1.5 x 19.99 = 29.99, three lines", async () => {
    const s = await sessionOf(OWNER);
    const a = await finance.createInvoice(s, { ...base, client: "X", items: [item("a", 1, 0.1), item("b", 1, 0.2)] });
    expect(a.amount).toBe(0.3);
    const b = await finance.createInvoice(s, { ...base, client: "X", items: [item("a", 1.5, 19.99)] });
    expect(b.amount).toBe(29.99);
    const c = await finance.createInvoice(s, { ...base, client: "X", items: [item("a", 1.5, 19.99), item("b", 1.005, 1), item("c", 1.005, 1)] });
    expect(c.amount).toBe(32.01);
    const legacy = await finance.createInvoice(s, { ...base, client: "Legacy", amount: 55 }); // amount-only caller (Work -> invoice)
    expect(legacy.amount).toBe(55);
    expect(legacy.items).toHaveLength(1);
    // the stored total equals the items, always
    expect(await q("select 1 from invoices i where i.amount <> coalesce((select sum(round(quantity*unit_price,2)) from invoice_items where invoice_id=i.id),0)")).toEqual([]);
  });

  it("partial payment -> partial, rest -> paid; overpayment is a conflict; one audit entry per payment", async () => {
    const s = await sessionOf(OWNER);
    const inv = await finance.createInvoice(s, { ...base, client: "P", items: [item("a", 1, 100)] });
    const part = await finance.recordPayment(s, { id: inv.id, amount: 30, method: "card" });
    expect(part).toMatchObject({ status: "partial", paidAmount: 30 });
    expect(part.payments).toHaveLength(1);
    const over = finance.recordPayment(s, { id: inv.id, amount: 70.01 });
    await expect(over).rejects.toBeInstanceOf(RepositoryConflictError);
    await over.catch((e) => expect(toActionError(e)).toBe("conflict"));
    const paid = await finance.updateInvoiceStatus(s, { id: inv.id, status: "paid" }); // pays the balance (70)
    expect(paid).toMatchObject({ status: "paid", paidAmount: 100 });
    const audit = await auditRows(inv.id);
    expect(audit.map((a) => a.action)).toEqual(["created", "statusChanged", "statusChanged"]);
    expect(audit.every((a) => a.summary.startsWith(inv.number))).toBe(true);
  });

  it("mark unpaid voids the payments (history kept); cancel is final", async () => {
    const s = await sessionOf(OWNER);
    const inv = await finance.createInvoice(s, { ...base, client: "U", items: [item("a", 1, 10)] });
    await finance.updateInvoiceStatus(s, { id: inv.id, status: "paid" });
    const back = await finance.updateInvoiceStatus(s, { id: inv.id, status: "unpaid" });
    expect(back).toMatchObject({ status: "unpaid", paidAmount: 0 });
    expect(back?.payments?.every((p) => p.voided)).toBe(true);
    const cancelled = await finance.updateInvoiceStatus(s, { id: inv.id, status: "cancelled" });
    expect(cancelled?.status).toBe("cancelled");
    await expect(finance.recordPayment(s, { id: inv.id, amount: 1 })).rejects.toBeInstanceOf(RepositoryConflictError);
    await expect(finance.updateInvoice(s, { id: inv.id, notes: "x" })).rejects.toBeInstanceOf(RepositoryConflictError);
    expect((await auditRows(inv.id)).at(-1)?.action).toBe("cancelled");
  });

  it("draft is issued by marking it unpaid", async () => {
    const s = await sessionOf(OWNER);
    const d = await finance.createInvoice(s, { ...base, client: "D", items: [item("a", 1, 5)], status: "draft" });
    expect(d.status).toBe("draft");
    expect((await finance.updateInvoiceStatus(s, { id: d.id, status: "unpaid" }))?.status).toBe("unpaid");
  });

  it("overdue is derived at read time; paid invoices are never overdue", async () => {
    const s = await sessionOf(OWNER);
    const open = await finance.createInvoice(s, { ...base, client: "O", items: [item("a", 1, 10)] });
    const done = await finance.createInvoice(s, { ...base, client: "O2", items: [item("a", 1, 10)] });
    await finance.updateInvoiceStatus(s, { id: done.id, status: "paid" });
    await q("update invoices set issued_at='2026-01-01', due_at='2026-01-10' where id in ($1,$2)", [open.id, done.id]);
    const list = await finance.listInvoices(s);
    expect(list.find((i) => i.id === open.id)?.status).toBe("overdue");
    expect(list.find((i) => i.id === done.id)?.status).toBe("paid");
    expect((await q<{ status: string }>("select status::text from invoices where id=$1", [open.id]))[0].status).toBe("sent"); // never stored
  });

  it("rejects invalid input before touching the database", async () => {
    const s = await sessionOf(OWNER);
    const bad = [
      { ...base, client: "" },
      { ...base, client: "x", items: [item("", 1, 1)] },
      { ...base, client: "x", items: [item("a", 0, 1)] },
      { ...base, client: "x", items: [item("a", 1, -1)] },
      { ...base, client: "x", dueDate: "05.10.2026" },
      { ...base, client: "x", clientId: "nope" },
      { ...base, client: "x", items: Array.from({ length: 101 }, () => item("a", 1, 1)) },
    ];
    for (const input of bad) await expect(finance.createInvoice(s, input as never)).rejects.toBeInstanceOf(ZodError);
    await expect(finance.recordPayment(s, { id: "x", amount: 0 })).rejects.toBeInstanceOf(ZodError);
    expect(toActionError(new ZodError([]))).toBe("invalid_input");
  });
});

describe("MAIN / PRIVATE isolation per role (service + RLS)", () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const s = await sessionOf(OWNER);
    const mk = async (key: string, o: Record<string, unknown>) => {
      const inv = await finance.createInvoice(s, { client: key, items: [item("x", 1, 100)], ...base, ...o } as never);
      await finance.updateInvoiceStatus(s, { id: inv.id, status: "paid" });
      ids[key] = inv.id;
    };
    await mk("sMain", {});
    await mk("sPrivateBucket", { bucket: "private" });
    await mk("sOwnerOnly", { visibility: "ownerOnly" });
  });

  it("owner sees everything including the private total", async () => {
    const sum = await finance.getFinanceSummary(await sessionOf(OWNER));
    expect(sum.invoices.map((i) => i.id)).toEqual(expect.arrayContaining(Object.values(ids)));
    expect(sum.revenue.private).toBeGreaterThanOrEqual(100);
    expect(sum.capabilities).toEqual({ canEdit: true, canUsePrivateBucket: true });
  });

  it("admin: Main only — no private invoice, no private total, cannot use the private bucket", async () => {
    const sum = await finance.getFinanceSummary(await sessionOf(ADMIN));
    const got = sum.invoices.map((i) => i.id);
    expect(got).toContain(ids.sMain);
    expect(got).not.toContain(ids.sPrivateBucket);
    expect(got).not.toContain(ids.sOwnerOnly);
    expect(sum.invoices.every((i) => i.bucket !== "private")).toBe(true);
    expect(sum.revenue.private).toBe(0);
    expect(sum.capabilities).toEqual({ canEdit: true, canUsePrivateBucket: false });
    expect(JSON.stringify(sum)).not.toContain(ids.sPrivateBucket); // nothing of it is even serialised
    expect(await finance.getInvoice(await sessionOf(ADMIN), ids.sPrivateBucket)).toBeUndefined();
  });

  it("accountant: reads Main + Private bucket, but cannot edit and does not see owner-only rows", async () => {
    const s = await sessionOf(ACCOUNTANT);
    const sum = await finance.getFinanceSummary(s);
    const got = sum.invoices.map((i) => i.id);
    expect(got).toContain(ids.sPrivateBucket);
    expect(got).not.toContain(ids.sOwnerOnly);
    expect(sum.capabilities).toEqual({ canEdit: false, canUsePrivateBucket: true });
    await expect(finance.createInvoice(s, { ...base, client: "x", amount: 1 })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(finance.recordPayment(s, { id: ids.sMain, amount: 1 })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("manager and staff have no finance access", async () => {
    for (const id of [MANAGER, STAFF]) {
      const s = await sessionOf(id);
      await expect(finance.getFinanceSummary(s)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(finance.listInvoices(s)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(finance.createInvoice(s, { ...base, client: "x", amount: 1 })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(finance.updateInvoiceStatus(s, { id: ids.sMain, status: "unpaid" })).rejects.toBeInstanceOf(PermissionDeniedError);
    }
  });

  it("admin cannot write into the private bucket or with private / owner-only visibility, and cannot touch hidden rows", async () => {
    const s = await sessionOf(ADMIN);
    await expect(finance.createInvoice(s, { ...base, bucket: "private", client: "x", amount: 1 })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(finance.createInvoice(s, { ...base, visibility: "ownerOnly", client: "x", amount: 1 })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(finance.createInvoice(s, { ...base, visibility: "private", client: "x", amount: 1 })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(finance.updateInvoice(s, { id: ids.sPrivateBucket, notes: "hacked" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(finance.updateInvoice(s, { id: ids.sMain, bucket: "private" })).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await finance.updateInvoiceStatus(s, { id: ids.sOwnerOnly, status: "unpaid" })).toBeUndefined();
    expect((await q<{ notes: string }>("select notes from invoices where id=$1", [ids.sPrivateBucket]))[0].notes).toBe("");
  });

  it("the Finance server action path returns a stable code for a denied caller", async () => {
    await expect(finance.getFinanceSummary(await sessionOf(STAFF))).rejects.toSatisfy((e: unknown) => toActionError(e) === "forbidden");
  });
});

describe("editing preserves what the simple UI cannot show", () => {
  it("custom bucket and owner_only visibility survive a plain edit; a same-class bucket keeps its id", async () => {
    const s = await sessionOf(OWNER);
    const inv = await finance.createInvoice(s, { client: "Keep", items: [item("x", 1, 10)], bucket: "custom", financialBucketId: customA2, visibility: "ownerOnly" });
    expect(inv).toMatchObject({ bucket: "custom", financialBucketId: customA2, visibility: "ownerOnly" });

    const e1 = await finance.updateInvoice(s, { id: inv.id, notes: "edited", dueDate: "2099-01-01" });
    expect(e1).toMatchObject({ bucket: "custom", financialBucketId: customA2, visibility: "ownerOnly", notes: "edited", dueDate: "2099-01-01" });

    const e2 = await finance.updateInvoice(s, { id: inv.id, bucket: "custom", visibility: "ownerOnly", items: [item("y", 2, 7.25)] });
    expect(e2).toMatchObject({ financialBucketId: customA2, visibility: "ownerOnly", amount: 14.5 });

    const e3 = await finance.updateInvoice(s, { id: inv.id, bucket: "main" });
    expect(e3).toMatchObject({ bucket: "main", financialBucketId: mainA, visibility: "ownerOnly" });
    expect((await auditRows(inv.id)).map((a) => a.action)).toEqual(["created", "updated", "updated", "updated"]);
  });

  it("a paid invoice keeps its lines (locked) but its notes can still change", async () => {
    const s = await sessionOf(OWNER);
    const inv = await finance.createInvoice(s, { ...base, client: "Locked", items: [item("x", 1, 10)] });
    await finance.updateInvoiceStatus(s, { id: inv.id, status: "paid" });
    await expect(finance.updateInvoice(s, { id: inv.id, items: [item("z", 1, 1)] })).rejects.toBeInstanceOf(RepositoryConflictError);
    expect((await finance.updateInvoice(s, { id: inv.id, notes: "receipt sent" })).notes).toBe("receipt sent");
  });
});

describe("tenant isolation and cross-workspace references", () => {
  it("refuses a client / appointment / bucket of another workspace", async () => {
    const s = await sessionOf(OWNER);
    await expect(finance.createInvoice(s, { ...base, client: "", clientId: clientB, amount: 1 })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(finance.createInvoice(s, { ...base, client: "x", appointmentId: apptB, amount: 1 })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(finance.createInvoice(s, { ...base, bucket: "custom", financialBucketId: customB, client: "x", amount: 1 })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    const own = await finance.createInvoice(s, { ...base, client: "x", amount: 1 });
    await expect(finance.updateInvoice(s, { id: own.id, clientId: clientB })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(toActionError(new RepositoryNotFoundError("x"))).toBe("not_found");
  });

  it("workspace B can neither read nor modify A's invoices; A's slug is not even resolvable for B", async () => {
    const a = await sessionOf(OWNER);
    const inv = await finance.createInvoice(a, { ...base, client: "Secret", items: [item("x", 1, 77)] });
    as(OTHER);
    await expect(getSession(slug)).rejects.toThrow();
    const b = await getSession(otherSlug);
    expect(await finance.getInvoice(b, inv.id)).toBeUndefined();
    expect((await finance.listInvoices(b)).map((i) => i.id)).not.toContain(inv.id);
    await expect(finance.updateInvoice(b, { id: inv.id, notes: "hacked" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(finance.recordPayment(b, { id: inv.id, amount: 1 })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(await finance.updateInvoiceStatus(b, { id: inv.id, status: "cancelled" })).toBeUndefined();
    // B tampers with a session that points at A's workspace id: RLS still returns nothing and refuses writes
    const forged = { userId: OTHER, workspaceId: wsId, role: "owner" as const };
    expect(await finance.listInvoices(forged)).toEqual([]);
    await expect(finance.createInvoice(forged, { ...base, client: "evil", amount: 1 })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect((await q<{ notes: string; status: string }>("select notes, status::text from invoices where id=$1", [inv.id]))[0]).toEqual({ notes: "", status: "sent" });
  });

  it("anon reads and writes nothing", async () => {
    const anonRepo = createSupabaseInvoicesRepository(wsId, async () => createPgliteSupabaseClient(db, { kind: "anon" }));
    await expect(anonRepo.list()).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(anonRepo.create({ id: "x", number: "", client: "e", amount: 0, currency: "EUR", status: "unpaid", bucket: "main", visibility: "normal", date: "2026-10-05" })).rejects.toBeInstanceOf(RepositoryForbiddenError);
  });

  it("invoices cannot be deleted through the repository", async () => {
    const repo = createSupabaseInvoicesRepository(wsId, async () => createPgliteSupabaseClient(db, { kind: "user", id: OWNER }));
    await expect(repo.remove("x")).rejects.toThrow(/cancel/);
  });
});

describe("demo gate", () => {
  it("a demo workspace never touches the database; a real workspace never sees demo invoices", async () => {
    const trap = new Proxy({}, { get: () => { throw new Error("demo workspace reached the database"); } }) as unknown as SupabaseClient;
    current = trap;
    const demo = { userId: "demo-user", workspaceId: "demo-salon", role: "owner" as const };
    const created = await finance.createInvoice(demo, { ...base, client: "Demo C", items: [item("x", 2, 10)] });
    expect(created.number).toMatch(/^#\d+/);
    expect(created.amount).toBe(20);
    const paid = await finance.recordPayment(demo, { id: created.id, amount: 5 });
    expect(paid).toMatchObject({ status: "partial", paidAmount: 5 });
    await expect(finance.recordPayment(demo, { id: created.id, amount: 100 })).rejects.toBeInstanceOf(RepositoryConflictError);
    expect((await finance.getFinanceSummary(demo)).invoices.length).toBeGreaterThan(0);

    as(OWNER);
    const realList = await getServerInvoicesRepository(wsId).list();
    expect(realList.some((i) => i.number.startsWith("#"))).toBe(false);
    expect(await finance.listInvoices(await sessionOf(OWNER))).toEqual(realList);
  });
});
