import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

// Real services -> real Supabase repositories -> a real Postgres (PGlite running every migration, incl. 0021),
// acting as whichever user the test selects (RLS, triggers, constraints and the conversion functions all run).
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const work = await import("@/server/services/work.service");
const registry = await import("@/server/repository/registry");
const { PermissionDeniedError } = await import("@/server/permissions/roles");
const { RepositoryForbiddenError, RepositoryNotFoundError } = await import("@/server/repository/errors");
const { BusinessRuleError } = await import("@/server/services/businessRuleError");
const { toActionError } = await import("@/server/actions/result");
const { ZodError } = await import("zod");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const ADMIN = "bbbbbbbb-0000-4000-8000-0000000000b2";
const MANAGER = "cccccccc-0000-4000-8000-0000000000c3";
const STAFF = "dddddddd-0000-4000-8000-0000000000d4";
const ACCOUNTANT = "ffffffff-0000-4000-8000-0000000000f6";
const OTHER = "eeeeeeee-0000-4000-8000-0000000000e5";

let db: PGlite;
let slug: string;
let wsId: string;
let otherSlug: string;
let otherWs: string;
let clientId: string;
let otherClient: string;
let staffId: string;
let otherStaff: string;
let mainBucket: string;
let privateBucket: string;
let customBucket: string;
let otherBucket: string;

const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const service = () => createPgliteSupabaseClient(db, { kind: "service" });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const sessionAs = async (id: string, s = slug) => (as(id), getSession(s));
const ownerSession = () => sessionAs(OWNER);
const count = async (table: string, where = "true") => Number((await q<{ n: string }>(`select count(*)::text n from ${table} where workspace_id = $1 and ${where}`, [wsId]))[0].n);
const titlesFor = async (id: string) => {
  const s = await sessionAs(id);
  return (await work.listLeads(s)).map((l) => l.title).sort();
};

beforeAll(async () => {
  db = await createMigratedDb();
  const users = [OWNER, ADMIN, MANAGER, STAFF, ACCOUNTANT, OTHER];
  await db.exec(`insert into auth.users (id,email) values ${users.map((u, i) => `('${u}','u${i}@test.invalid')`).join(",")}`);
  const prov = async (user: string, email: string, name: string, base: string) =>
    ((await service().rpc("provision_workspace", { p_user_id: user, p_email: email, p_full_name: "", p_business_name: name, p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[])[0];
  const a = await prov(OWNER, "u0@test.invalid", "Biz", "work-biz");
  wsId = a.out_workspace_id;
  slug = a.out_slug;
  const b = await prov(OTHER, "u5@test.invalid", "Other", "work-other");
  otherWs = b.out_workspace_id;
  otherSlug = b.out_slug;
  const roles: [string, string][] = [[ADMIN, "admin"], [MANAGER, "manager"], [STAFF, "staff"], [ACCOUNTANT, "accountant"]];
  for (const [id, role] of roles) {
    await db.exec(`insert into profiles (id,email) values ('${id}','${role}@test.invalid') on conflict do nothing;
      insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${id}','${role}')`);
  }
  clientId = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Secret Client','sc@example.test') returning id", [wsId]))[0].id;
  otherClient = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Theirs','t@example.test') returning id", [otherWs]))[0].id;
  staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
  otherStaff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [otherWs]))[0].id;
  mainBucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [wsId]))[0].id;
  privateBucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='private'", [wsId]))[0].id;
  otherBucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [otherWs]))[0].id;
  customBucket = (await q<{ id: string }>("insert into financial_buckets (workspace_id,name,slug,kind) values ($1,'Side','side','custom') returning id", [wsId]))[0].id;
}, 90_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("Lead -> Quote -> accepted -> Job (+ Project), one client throughout", () => {
  it("runs the whole flow with the same client, decimal-safe totals, one audit entry per step and no PII in audit", async () => {
    const s = await ownerSession();
    const lead = await work.createLead(s, { clientId, clientName: "Secret Client", title: "Kitchen remodel", notes: "call after 5", source: "web", estimatedValue: 1000 });
    expect(lead).toMatchObject({ stage: "new", clientId, clientName: "Secret Client", quoteId: null, financialBucket: "main", visibility: "normal" });

    const { quoteId, created } = await work.convertLeadToQuote(s, lead.id);
    expect(created).toBe(true);
    const quote = (await work.listQuotes(s)).find((x) => x.id === quoteId)!;
    expect(quote).toMatchObject({ leadId: lead.id, clientId, status: "draft", amount: 1000, financialBucket: "main", visibility: "normal", jobId: null });
    expect((await work.listLeads(s)).find((l) => l.id === lead.id)).toMatchObject({ stage: "quoted", quoteId });

    // exact decimals: 3 x 19.99 + 1.5 x 0.10 + 2 x 0.10 = 59.97 + 0.15 + 0.20 = 60.32 (floats would give 60.320000000000007)
    const withItems = await work.updateQuote(s, quoteId, {
      items: [
        { description: "Cabinets", quantity: 3, unitPrice: 19.99 },
        { description: "Screws", quantity: 1.5, unitPrice: 0.1 },
        { description: "Glue", quantity: 2, unitPrice: 0.1 },
      ],
      validUntil: "2026-12-31",
    });
    expect(withItems.amount).toBe(60.32);
    expect(withItems.items?.map((i) => i.description)).toEqual(["Cabinets", "Screws", "Glue"]);
    expect(withItems.validUntil).toBe("2026-12-31");
    await work.updateQuote(s, quoteId, { status: "sent" });

    const accepted = await work.acceptQuoteCreateJob(s, quoteId);
    expect(accepted.created).toBe(true);
    const job = (await work.listJobs(s)).find((j) => j.id === accepted.jobId)!;
    expect(job).toMatchObject({ quoteId, clientId, amount: 60.32, status: "scheduled", financialBucket: "main", projectId: null });
    const after = (await work.listQuotes(s)).find((x) => x.id === quoteId)!;
    expect(after).toMatchObject({ status: "accepted", jobId: job.id });
    expect((await work.listLeads(s)).find((l) => l.id === lead.id)?.stage).toBe("won");

    // project for the job, then attach a second job to it
    const proj = await work.createProjectForJob(s, job.id);
    expect(proj.created).toBe(true);
    expect((await work.listJobs(s)).find((j) => j.id === job.id)?.projectId).toBe(proj.projectId);
    expect((await work.listProjects(s)).find((p) => p.id === proj.projectId)).toMatchObject({ clientId, status: "active" });
    const extra = await work.createJob(s, { clientId, clientName: "", title: "Extra", staffId, startsOn: "2026-11-01", dueOn: "2026-11-05" });
    await work.attachJobToProject(s, extra.id, proj.projectId);
    expect((await work.listJobs(s)).find((j) => j.id === extra.id)).toMatchObject({ projectId: proj.projectId, staffId, startsOn: "2026-11-01", dueOn: "2026-11-05" });

    // never a second client
    expect(await count("clients")).toBe(1);

    // audit: one entry per create / status change / conversion, and no names / free text / amounts
    const logs = await q<{ entity_type: string; summary: string; source: string }>(
      "select entity_type, summary, source from audit_logs where workspace_id=$1 and entity_type in ('lead','quote','job','project') order by created_at",
      [wsId],
    );
    expect(logs.length).toBeGreaterThanOrEqual(8);
    for (const l of logs) {
      expect(l.source).toBe("user");
      expect(l.summary).not.toMatch(/Secret|Kitchen|Cabinets|call after|1000|60\.32/i);
    }
    expect(logs.filter((l) => l.summary === "Quote created from lead")).toHaveLength(1);
    expect(logs.filter((l) => l.summary === "Quote accepted, job created")).toHaveLength(1);
  });

  it("a plain edit of the simple fields keeps every other column", async () => {
    const s = await ownerSession();
    const lead = await work.createLead(s, { clientName: "Prospect without account", title: "Edit me", notes: "n", currency: "EUR" });
    const edited = await work.updateLead(s, lead.id, { title: "Edited", stage: "contacted" });
    expect(edited).toMatchObject({ title: "Edited", stage: "contacted", notes: "n", clientName: "Prospect without account", clientId: null });
  });
});

describe("Idempotent conversions and races", () => {
  it("a second conversion returns the existing quote / job; Promise.all creates exactly one", async () => {
    const s = await ownerSession();
    const lead = await work.createLead(s, { clientId, clientName: "", title: "Race lead", estimatedValue: 50 });
    const [a, b, c] = await Promise.all([work.convertLeadToQuote(s, lead.id), work.convertLeadToQuote(s, lead.id), work.convertLeadToQuote(s, lead.id)]);
    expect(new Set([a.quoteId, b.quoteId, c.quoteId]).size).toBe(1);
    expect([a, b, c].filter((r) => r.created)).toHaveLength(1);
    expect(await count("quotes", `lead_id = '${lead.id}'`)).toBe(1);

    const results = await Promise.all([1, 2, 3, 4].map(() => work.acceptQuoteCreateJob(s, a.quoteId)));
    expect(new Set(results.map((r) => r.jobId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await count("jobs", `quote_id = '${a.quoteId}'`)).toBe(1);

    const again = await work.acceptQuoteCreateJob(s, a.quoteId);
    expect(again).toEqual({ jobId: results[0].jobId, created: false });
    const proj = await work.createProjectForJob(s, again.jobId);
    expect(await work.createProjectForJob(s, again.jobId)).toEqual({ projectId: proj.projectId, created: false });
    // repeated conversions wrote exactly one audit entry each
    expect(await count("audit_logs", `entity_type='quote' and entity_id='${a.quoteId}' and summary='Quote accepted, job created'`)).toBe(1);
  });

  it("the unique indexes are the backstop even for raw inserts", async () => {
    const s = await ownerSession();
    const lead = await work.createLead(s, { clientId, clientName: "", title: "Backstop" });
    const { quoteId } = await work.convertLeadToQuote(s, lead.id);
    await expect(
      db.query("insert into quotes (workspace_id,title,lead_id) values ($1,'dup',$2)", [wsId, lead.id]),
    ).rejects.toMatchObject({ code: "23505" });
    await work.acceptQuoteCreateJob(s, quoteId);
    await expect(db.query("insert into jobs (workspace_id,title,quote_id) values ($1,'dup',$2)", [wsId, quoteId])).rejects.toMatchObject({ code: "23505" });
  });
});

describe("Invalid transitions are refused with clear errors", () => {
  it("converting a lost lead, accepting a declined quote, re-opening an accepted one with a job, client mismatch", async () => {
    const s = await ownerSession();
    const lost = await work.createLead(s, { clientId, clientName: "", title: "Lost one" });
    await work.updateLead(s, lost.id, { stage: "lost" });
    const err = await work.convertLeadToQuote(s, lost.id).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect(err.code).toBe("invalid_work_transition");
    expect(toActionError(err)).toBe("conflict");
    expect(await count("quotes", `lead_id = '${lost.id}'`)).toBe(0);

    const quote = await work.createQuote(s, { clientId, clientName: "", title: "Declined", amount: 10 });
    await work.updateQuote(s, quote.id, { status: "declined" });
    await expect(work.acceptQuoteCreateJob(s, quote.id)).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(work.updateQuote(s, quote.id, { status: "accepted" })).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await count("jobs", `quote_id = '${quote.id}'`)).toBe(0);
    // re-opened (sent) it can be accepted
    await work.updateQuote(s, quote.id, { status: "sent" });
    const { jobId } = await work.acceptQuoteCreateJob(s, quote.id);
    await expect(work.updateQuote(s, quote.id, { status: "draft" })).rejects.toBeInstanceOf(BusinessRuleError);
    // an accepted quote's items are locked
    await expect(work.updateQuote(s, quote.id, { items: [{ description: "x", quantity: 1, unitPrice: 1 }] })).rejects.toBeInstanceOf(BusinessRuleError);

    // project of another client
    const otherClientInWs = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Second','s2@example.test') returning id", [wsId]))[0].id;
    const foreignProject = await work.createProject(s, { clientId: otherClientInWs, clientName: "", title: "Not yours" });
    await expect(work.attachJobToProject(s, jobId, foreignProject.id)).rejects.toBeInstanceOf(BusinessRuleError);
    const quote2 = await work.createQuote(s, { clientId, clientName: "", title: "Q2" });
    await expect(work.acceptQuoteCreateJob(s, quote2.id, foreignProject.id)).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await count("jobs", `quote_id = '${quote2.id}'`)).toBe(0);
  });

  it("validates input (zod): bad money, bad dates, bad status", async () => {
    const s = await ownerSession();
    await expect(work.createQuote(s, { clientName: "", title: "x", amount: 1.005 })).rejects.toBeInstanceOf(ZodError);
    await expect(work.createQuote(s, { clientName: "", title: "x", amount: -1 })).rejects.toBeInstanceOf(ZodError);
    await expect(work.createJob(s, { clientName: "", title: "x", dueOn: "tomorrow" })).rejects.toBeInstanceOf(ZodError);
    await expect(work.createLead(s, { clientName: "", title: "   " })).rejects.toBeInstanceOf(ZodError);
    await expect(work.updateLead(s, "x", { stage: "nope" as never })).rejects.toBeInstanceOf(ZodError);
    await expect(work.createJob(s, { clientName: "", title: "bad range", startsOn: "2026-05-02", dueOn: "2026-05-01" })).rejects.toBeTruthy();
  });
});

describe("Tenant isolation", () => {
  it("B cannot read or write A's work, even with A's workspace id (forged session)", async () => {
    const s = await ownerSession();
    const lead = await work.createLead(s, { clientId, clientName: "", title: "A only" });
    const { quoteId } = await work.convertLeadToQuote(s, lead.id);

    const b = await sessionAs(OTHER, otherSlug);
    expect(await work.listLeads(b)).toEqual([]);
    await expect(sessionAs(OTHER, slug)).rejects.toThrow(); // B is not a member of A's workspace

    // forged: B's real database identity, A's workspace id
    const forged = { ...b, workspaceId: wsId };
    expect(await work.listLeads(forged)).toEqual([]);
    expect(await work.listQuotes(forged)).toEqual([]);
    await expect(work.updateLead(forged, lead.id, { title: "hacked" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(work.convertLeadToQuote(forged, lead.id)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(work.acceptQuoteCreateJob(forged, quoteId)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(work.createLead(forged, { clientName: "", title: "planted" })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(work.archiveWork(forged, "lead", lead.id)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect((await q<{ title: string }>("select title from leads where id=$1", [lead.id]))[0].title).toBe("A only");
    expect(await count("leads", "title = 'planted'")).toBe(0);
  });

  it("cross-workspace client / staff / bucket / lead / quote / project references are refused", async () => {
    const s = await ownerSession();
    await expect(work.createLead(s, { clientId: otherClient, clientName: "", title: "x" })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(work.createJob(s, { clientName: "", title: "x", staffId: otherStaff })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(work.createLead(s, { clientName: "", title: "x", financialBucket: "custom", financialBucketId: otherBucket })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    // raw writes (service role bypasses RLS but NOT the same-workspace guards)
    const otherLead = (await q<{ id: string }>("insert into leads (workspace_id,title) values ($1,'theirs') returning id", [otherWs]))[0].id;
    const otherProject = (await q<{ id: string }>("insert into projects (workspace_id,title) values ($1,'theirs') returning id", [otherWs]))[0].id;
    const otherQuote = (await q<{ id: string }>("insert into quotes (workspace_id,title) values ($1,'theirs') returning id", [otherWs]))[0].id;
    const otherJob = (await q<{ id: string }>("insert into jobs (workspace_id,title) values ($1,'theirs') returning id", [otherWs]))[0].id;
    await expect(db.query("insert into quotes (workspace_id,title,lead_id) values ($1,'x',$2)", [wsId, otherLead])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("insert into jobs (workspace_id,title,project_id) values ($1,'x',$2)", [wsId, otherProject])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("insert into jobs (workspace_id,title,quote_id) values ($1,'x',$2)", [wsId, otherQuote])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("insert into quote_items (workspace_id,quote_id,description) values ($1,$2,'x')", [wsId, otherQuote])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update leads set workspace_id=$1 where id=$2", [otherWs, otherLead])).resolves.toBeTruthy(); // same ws: fine
    const mine = (await q<{ id: string }>("insert into leads (workspace_id,title) values ($1,'mine') returning id", [wsId]))[0].id;
    await expect(db.query("update leads set workspace_id=$1 where id=$2", [otherWs, mine])).rejects.toMatchObject({ code: "23514" });
    // the invoice relation columns are guarded too
    const inv = (await q<{ id: string }>("insert into invoices (workspace_id,number) values ($1,'W-1') returning id", [wsId]))[0].id;
    await expect(db.query("update invoices set job_id=$1 where id=$2", [otherJob, inv])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update invoices set quote_id=$1 where id=$2", [otherQuote, inv])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update invoices set project_id=$1 where id=$2", [otherProject, inv])).rejects.toMatchObject({ code: "23514" });
    const myJob = (await q<{ id: string }>("insert into jobs (workspace_id,title) values ($1,'mine') returning id", [wsId]))[0].id;
    await db.query("update invoices set job_id=$1 where id=$2", [myJob, inv]);
    // ON DELETE SET NULL on the finance relation; the invoice itself survives
    await db.query("delete from jobs where id=$1", [myJob]);
    expect((await q<{ job_id: string | null }>("select job_id from invoices where id=$1", [inv]))[0].job_id).toBeNull();
  });

  it("a job shows its linked invoice number when the reader may see invoices (Finance); never an error otherwise", async () => {
    const s = await ownerSession();
    const job = await work.createJob(s, { clientId, clientName: "", title: "Billed job" });
    const inv = (await q<{ id: string }>("insert into invoices (workspace_id,number,job_id) values ($1,'W-INV-7',$2) returning id", [wsId, job.id]))[0].id;
    const listed = (await work.listJobs(s)).find((j) => j.id === job.id)!;
    // visible only if Finance's RLS (0022) lets this role read invoices; either way no failure and ids never leak sideways
    expect([null, inv]).toContain(listed.invoiceId);
    if (listed.invoiceId) expect(listed.invoiceNumber).toBe("W-INV-7");
  });
});

describe("Visibility and financial bucket are independent axes (role matrix)", () => {
  let normalMain: string;
  let normalPrivateBucket: string;
  let ownerOnlyMain: string;
  let privateVisMain: string;
  let customCustom: string;

  it("owner creates rows for every combination", async () => {
    const s = await ownerSession();
    normalMain = (await work.createLead(s, { clientName: "", title: "V-normal-main" })).id;
    normalPrivateBucket = (await work.createLead(s, { clientName: "", title: "V-normal-privatebucket", financialBucket: "private" })).id;
    ownerOnlyMain = (await work.createLead(s, { clientName: "", title: "V-owneronly-main", visibility: "ownerOnly" })).id;
    privateVisMain = (await work.createLead(s, { clientName: "", title: "V-private-main", visibility: "private" })).id;
    customCustom = (await work.createLead(s, { clientName: "", title: "V-custom-custom", visibility: "custom", financialBucket: "custom", financialBucketId: customBucket })).id;
    const rows = await q<{ title: string; visibility: string; financial_bucket_id: string }>("select title, visibility, financial_bucket_id from leads where title like 'V-%' order by title");
    expect(rows).toEqual([
      { title: "V-custom-custom", visibility: "custom", financial_bucket_id: customBucket },
      { title: "V-normal-main", visibility: "normal", financial_bucket_id: mainBucket },
      { title: "V-normal-privatebucket", visibility: "normal", financial_bucket_id: privateBucket },
      { title: "V-owneronly-main", visibility: "owner_only", financial_bucket_id: mainBucket },
      { title: "V-private-main", visibility: "private", financial_bucket_id: mainBucket },
    ]);
    expect((await titlesFor(OWNER)).filter((t) => t.startsWith("V-"))).toHaveLength(5);
  });

  it("admin / manager / staff see neither private-bucket rows nor owner-only / private / custom visibility rows", async () => {
    for (const id of [ADMIN, MANAGER, STAFF]) {
      const visible = (await titlesFor(id)).filter((t) => t.startsWith("V-"));
      expect(visible, id).toEqual(["V-normal-main"]);
    }
  });

  it("accountant has no Work access at all (no clients.view)", async () => {
    const s = await sessionAs(ACCOUNTANT);
    await expect(work.listLeads(s)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(work.createLead(s, { clientName: "", title: "x" })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("staff can read but not write; manager/admin write only rows they may see", async () => {
    const staff = await sessionAs(STAFF);
    await expect(work.createLead(staff, { clientName: "", title: "no" })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(work.updateLead(staff, normalMain, { title: "no" })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(work.convertLeadToQuote(staff, normalMain)).rejects.toBeInstanceOf(PermissionDeniedError);
    const manager = await sessionAs(MANAGER);
    await expect(work.createLead(manager, { clientName: "", title: "mgr-private-bucket", financialBucket: "private" })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(work.createLead(manager, { clientName: "", title: "mgr-owner-only", visibility: "ownerOnly" })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    // cannot touch rows hidden from them: as if they do not exist
    await expect(work.updateLead(manager, normalPrivateBucket, { title: "hijack" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(work.updateLead(manager, ownerOnlyMain, { title: "hijack" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(work.convertLeadToQuote(manager, ownerOnlyMain)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    // and cannot move a visible row INTO a hidden state (WITH CHECK)
    await expect(work.updateLead(manager, normalMain, { visibility: "ownerOnly" })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(work.updateLead(manager, normalMain, { financialBucket: "private" })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    const ok = await work.createLead(manager, { clientName: "", title: "mgr-ok" });
    expect(ok.title).toBe("mgr-ok");
    expect((await q<{ title: string }>("select title from leads where id in ($1,$2,$3)", [normalPrivateBucket, ownerOnlyMain, normalMain])).map((r) => r.title).sort()).toEqual(["V-normal-main", "V-normal-privatebucket", "V-owneronly-main"]);
  });

  it("the conversion copies visibility and bucket from the source (never merged) unless overridden", async () => {
    const s = await ownerSession();
    const q1 = await work.convertLeadToQuote(s, privateVisMain);
    expect((await q<Record<string, unknown>>("select visibility, financial_bucket_id from quotes where id=$1", [q1.quoteId]))[0]).toEqual({ visibility: "private", financial_bucket_id: mainBucket });
    const q2 = await work.convertLeadToQuote(s, normalPrivateBucket);
    expect((await q<Record<string, unknown>>("select visibility, financial_bucket_id from quotes where id=$1", [q2.quoteId]))[0]).toEqual({ visibility: "normal", financial_bucket_id: privateBucket });
    const q3 = await work.convertLeadToQuote(s, customCustom);
    expect((await q<Record<string, unknown>>("select visibility, financial_bucket_id from quotes where id=$1", [q3.quoteId]))[0]).toEqual({ visibility: "custom", financial_bucket_id: customBucket });
    const j = await work.acceptQuoteCreateJob(s, q3.quoteId, null, { visibility: "ownerOnly", financialBucketId: mainBucket });
    expect((await q<Record<string, unknown>>("select visibility, financial_bucket_id from jobs where id=$1", [j.jobId]))[0]).toEqual({ visibility: "owner_only", financial_bucket_id: mainBucket });
    // a manager cannot convert into a state they could not see
    const manager = await sessionAs(MANAGER);
    const mq = await work.convertLeadToQuote(manager, normalMain);
    await expect(work.acceptQuoteCreateJob(manager, mq.quoteId, null, { visibility: "ownerOnly" })).rejects.toBeTruthy();
    expect(await count("jobs", `quote_id = '${mq.quoteId}'`)).toBe(0);
    // quote items of an invisible quote are invisible too
    as(OWNER);
    await work.updateQuote(s, q2.quoteId, { items: [{ description: "secret item", quantity: 1, unitPrice: 5 }] });
    const items = await manager_items();
    expect((items as { description: string }[]).map((i) => i.description)).not.toContain("secret item");
    as(OWNER);
    expect(((await current.from("quote_items").select("description").eq("workspace_id", wsId)).data as { description: string }[]).map((i) => i.description)).toContain("secret item");
  });

  async function manager_items() {
    as(MANAGER);
    return (await current.from("quote_items").select("description").eq("workspace_id", wsId)).data;
  }

  it("owner_only / custom visibility and custom buckets survive edits that do not name them", async () => {
    const s = await ownerSession();
    const before = await work.updateLead(s, customCustom, { title: "V-custom-custom (edited)", notes: "edited" });
    expect(before).toMatchObject({ visibility: "custom", financialBucket: "custom", financialBucketId: customBucket });
    const oo = await work.updateLead(s, ownerOnlyMain, { stage: "contacted" });
    expect(oo.visibility).toBe("ownerOnly");
    const row = (await q<Record<string, unknown>>("select visibility, financial_bucket_id from leads where id=$1", [customCustom]))[0];
    expect(row).toEqual({ visibility: "custom", financial_bucket_id: customBucket });
    // an edit that names the bucket by kind only (simple UI "Main") is explicit and does change it
    const moved = await work.updateLead(s, customCustom, { financialBucket: "main" });
    expect(moved.financialBucketId).toBe(mainBucket);
    expect(moved.visibility).toBe("custom"); // the other axis is untouched
  });
});

describe("History: archive instead of delete; anon sees nothing", () => {
  it("archive hides from lists but keeps the row and everything that references it; hard deletes are refused", async () => {
    const s = await ownerSession();
    const lead = await work.createLead(s, { clientId, clientName: "", title: "History lead" });
    const { quoteId } = await work.convertLeadToQuote(s, lead.id);
    const { jobId } = await work.acceptQuoteCreateJob(s, quoteId);
    await work.archiveWork(s, "lead", lead.id);
    expect((await work.listLeads(s)).some((l) => l.id === lead.id)).toBe(false);
    expect(await count("leads", `id = '${lead.id}' and archived`)).toBe(1);
    expect((await work.listQuotes(s)).find((x) => x.id === quoteId)?.leadId).toBe(lead.id);
    // an archived lead cannot start new conversions / its quote still exists
    expect((await work.convertLeadToQuote(s, lead.id)).created).toBe(false);

    // no DELETE grant for signed-in users (RLS has no delete policy either)
    for (const table of ["leads", "quotes", "jobs", "projects"]) {
      const r = await (as(OWNER), current.from(table).delete().eq("workspace_id", wsId));
      expect(r.error, table).toBeTruthy();
    }
    expect(await count("leads", `id = '${lead.id}'`)).toBe(1);
    // even the service role cannot orphan history: FKs are NO ACTION
    for (const sql of [
      ["delete from leads where id=$1", lead.id],
      ["delete from quotes where id=$1", quoteId],
      ["delete from clients where id=$1", clientId],
    ] as const) {
      await expect(db.query(sql[0], [sql[1]])).rejects.toMatchObject({ code: "23503" });
    }
    const assigned = await work.createJob(s, { clientName: "", title: "Assigned", staffId });
    await expect(db.query("delete from staff_profiles where id=$1", [staffId])).rejects.toMatchObject({ code: "23503" });
    expect(assigned.staffId).toBe(staffId);
    expect((await work.listJobs(s)).some((j) => j.id === jobId)).toBe(true);
  });

  it("a whole-workspace deletion still cascades", async () => {
    const t = (await service().rpc("provision_workspace", { p_user_id: OTHER, p_email: "u5@test.invalid", p_full_name: "", p_business_name: "Temp", p_base_slug: "work-temp", p_locale: "en" })).data as { out_workspace_id: string }[];
    const ws = t[0].out_workspace_id;
    const c = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'T','t@t.example') returning id", [ws]))[0].id;
    const l = (await q<{ id: string }>("insert into leads (workspace_id,title,client_id) values ($1,'t',$2) returning id", [ws, c]))[0].id;
    await db.query("insert into quotes (workspace_id,title,lead_id,client_id) values ($1,'t',$2,$3)", [ws, l, c]);
    await db.query("delete from workspaces where id=$1", [ws]);
    expect((await q("select 1 from leads where workspace_id=$1", [ws])).length).toBe(0);
  });

  it("anon cannot read, write or convert", async () => {
    const anon = createPgliteSupabaseClient(db, { kind: "anon" });
    for (const table of ["leads", "quotes", "quote_items", "jobs", "projects"]) {
      const r = await anon.from(table).select("*");
      expect(r.error, table).toBeTruthy();
    }
    expect((await anon.from("leads").insert({ workspace_id: wsId, title: "x" })).error).toBeTruthy();
    expect((await anon.rpc("convert_lead_to_quote", { p_lead_id: crypto.randomUUID() })).error).toBeTruthy();
    expect((await anon.rpc("can_see_work_row", { p_workspace_id: wsId, p_visibility: "normal", p_bucket_id: null })).error).toBeTruthy();
  });

  it("a signed-in user without membership gets nothing back from the conversion functions", async () => {
    const lead = (await q<{ id: string }>("select id from leads where workspace_id=$1 limit 1", [wsId]))[0].id;
    as(OTHER);
    const r = await current.rpc("convert_lead_to_quote", { p_lead_id: lead });
    expect(r.error).toBeTruthy();
  });
});

describe("Demo gate and registry", () => {
  it("demo workspaces keep the in-memory demo records; real ones use the Supabase adapters (never the mock)", async () => {
    const leads = await registry.getServerLeadsRepository("demo-salon").list();
    expect(leads.length).toBeGreaterThan(0);
    const real = registry.getServerLeadsRepository(wsId);
    expect(real).not.toBe(registry.getServerLeadsRepository("demo-salon"));
    expect(typeof real.list).toBe("function");
    expect((await ownerSession()).workspaceId).toBe(wsId);
    // real workspace data comes from the database, not the demo seeds
    const s = await ownerSession();
    expect((await work.listLeads(s)).some((l) => l.title === leads[0].title)).toBe(false);
  });

  it("demo conversions follow the same rules over the mock repositories", async () => {
    const ops = registry.getServerWorkOps("demo-salon");
    const lead = (await registry.getServerLeadsRepository("demo-salon").list())[0];
    const a = await ops.convertLeadToQuote(lead.id);
    const b = await ops.convertLeadToQuote(lead.id);
    expect(a.created).toBe(true);
    expect(b).toEqual({ quoteId: a.quoteId, created: false });
    const job = await ops.acceptQuoteCreateJob(a.quoteId);
    expect((await ops.acceptQuoteCreateJob(a.quoteId)).jobId).toBe(job.jobId);
    const lost = (await registry.getServerLeadsRepository("demo-salon").list())[1];
    await registry.getServerLeadsRepository("demo-salon").update(lost.id, { stage: "lost" });
    await expect(ops.convertLeadToQuote(lost.id)).rejects.toBeInstanceOf(BusinessRuleError);
  });
});
