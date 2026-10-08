import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { makeTeamWorld, type TeamWorld, type Tenant } from "./teamStagingWorld";

/**
 * Team staging, part 2: THREE businesses on one shared database, each with data in EVERY module. For every
 * ordered pair (X, Y) the owner of X must not be able to read or change anything of Y — through the real
 * services with a forged session, through direct user-scoped table access, through the RPCs, and through
 * foreign keys. "Nothing changed" is proven by hashing ALL of Y's rows before and after the attacks.
 */
vi.mock("@/lib/supabase/server", async () => ({ createSupabaseServerClient: async () => (await import("./teamStagingWorld")).holder.user }));
vi.mock("@/lib/supabase/admin", async () => ({ createSupabaseAdminClient: () => ({ rpc: async (n: string, a: Record<string, unknown>) => (await import("./teamStagingWorld")).holder.admin!.rpc(n, a) }) }));
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";

const svc = {
  clients: await import("@/server/services/clients.service"),
  appts: await import("@/server/services/appointments.service"),
  services: await import("@/server/services/services.service"),
  staff: await import("@/server/services/staffAdmin.service"),
  resources: await import("@/server/services/resourcesAdmin.service"),
  hours: await import("@/server/services/workingHours.service"),
  work: await import("@/server/services/work.service"),
  fin: await import("@/server/services/finance.service"),
  wl: await import("@/server/services/waitingList.service"),
  inbox: await import("@/server/services/inbox.service"),
  analytics: await import("@/server/services/analytics.service"),
  profile: await import("@/server/services/businessProfile.service"),
  rules: await import("@/server/services/bookingRules.service"),
  related: await import("@/server/services/crossModule.service"),
  onboarding: await import("@/server/services/onboarding.service"),
};

let db: PGlite;
let w: TeamWorld;
type Seed = Awaited<ReturnType<TeamWorld["seedAll"]>>;
const T: Record<string, Tenant> = {};
const S: Record<string, Seed> = {};
const KEYS = ["A", "B", "C"] as const;
const PAIRS = KEYS.flatMap((x) => KEYS.filter((y) => y !== x).map((y) => [x, y] as const));

beforeAll(async () => {
  db = await createMigratedDb();
  w = makeTeamWorld(db);
  for (const k of KEYS) {
    T[k] = await w.signUp(`Business ${k}`, `owner-${k.toLowerCase()}@t.invalid`);
    S[k] = await w.seedAll(T[k], k.repeat(3));
  }
}, 180_000);
afterAll(async () => db.close());

const userClient = (id: string) => createPgliteSupabaseClient(db, { kind: "user", id });
const anonClient = () => createPgliteSupabaseClient(db, { kind: "anon" });

/** One hash over every row of every tenant table (+ the workspace row itself) of a workspace. */
async function snapshot(ws: string): Promise<string> {
  const h = createHash("sha256");
  for (const t of await w.tenantTables()) {
    const rows = await w.q<{ j: string }>(`select to_jsonb(t)::text j from public."${t}" t where workspace_id = $1 order by 1`, [ws]);
    h.update(t + JSON.stringify(rows.map((r) => r.j)));
  }
  h.update(JSON.stringify(await w.q("select to_jsonb(w)::text j from workspaces w where id = $1", [ws])));
  return h.digest("hex");
}

/**
 * An attack is "blocked" when it throws, or comes back with nothing (undefined / null / false / 0 / []).
 * A refusal caused by a malformed attack (zod validation, TypeError, permission check) proves nothing, so
 * those are reported as `invalid-attack` instead: the attacks must reach the database / repository layer.
 */
async function blocked(fn: () => Promise<unknown>): Promise<boolean | "invalid-attack"> {
  try {
    const r = await fn();
    return r === undefined || r === null || r === false || r === 0 || (Array.isArray(r) && r.length === 0);
  } catch (e) {
    return ["ZodError", "TypeError", "RangeError", "ReferenceError", "PermissionDeniedError"].includes((e as Error)?.name) ? "invalid-attack" : true;
  }
}
/** Runs every named attack and returns the names of those that were NOT refused (or were malformed). */
async function survivors(attacks: Record<string, () => Promise<unknown>>): Promise<string[]> {
  const out: string[] = [];
  for (const [name, fn] of Object.entries(attacks)) {
    const r = await blocked(fn);
    if (r !== true) out.push(r === false ? name : `${name} (${r})`);
  }
  return out;
}

describe("fixtures: every module has data in every workspace", () => {
  it("each workspace has rows in all the business tables", async () => {
    for (const k of KEYS) {
      const f = await w.footprint(T[k].ws);
      for (const table of ["clients", "services", "staff_profiles", "resources", "working_hours", "time_off", "appointments", "leads", "quotes", "jobs", "projects", "invoices", "payments", "waiting_list", "inbox_events", "audit_logs", "financial_buckets"]) {
        expect(f[table], `${k}.${table}`).toBeGreaterThan(0);
      }
    }
  });

  it("each owner sees exactly their own data in every module (no neighbour tag anywhere)", async () => {
    for (const k of KEYS) {
      const all = await w.readAll(await w.session(T[k].userId, T[k].slug));
      const json = JSON.stringify(all);
      expect(json).toContain(k.repeat(3));
      for (const other of KEYS.filter((o) => o !== k)) expect(json).not.toContain(other.repeat(3));
      expect(all.clients).toHaveLength(1);
      expect(all.invoices).toHaveLength(2); // main + private bucket, both the owner's own
    }
  });
});

describe.each(PAIRS)("X=%s attacks Y=%s", (x, y) => {
  const own = () => w.session(T[x].userId, T[x].slug);
  const forged = async () => ({ ...(await own()), workspaceId: T[y].ws });
  const Y = () => S[y];
  const X = () => S[x];
  let before: string;

  beforeAll(async () => {
    before = await snapshot(T[y].ws);
  });

  it("(a) services/repositories with a forged session pointing at Y: nothing is readable", async () => {
    const f = await forged();
    const all = await w.readAll(f);
    expect(all.clients).toEqual([]);
    expect(all.appointments).toEqual([]);
    expect(all.services).toEqual([]);
    expect(all.invoices).toEqual([]);
    expect(all.leads).toEqual([]);
    expect(all.quotes).toEqual([]);
    expect(all.jobs).toEqual([]);
    expect(all.projects).toEqual([]);
    expect(all.waiting).toEqual([]);
    expect(all.inbox).toEqual([]);
    expect(all.timeOff).toEqual([]);
    expect(all.resources).toEqual([]);
    expect(all.staff).toEqual([]);
    expect(JSON.stringify(all)).not.toContain(y.repeat(3));
    expect(await svc.clients.getClient(f, Y().client.id)).toBeUndefined();
    expect(await svc.fin.getInvoice(f, Y().invoice.id)).toBeUndefined();
    expect(await svc.fin.getInvoice(f, Y().privInvoice.id)).toBeUndefined();
    expect(await svc.appts.getAppointment(f, Y().appointment.id)).toBeUndefined();
    expect(await survivors({ related: () => svc.related.getClientRelated(f, Y().client.id), profile: () => svc.profile.getBusinessProfile(f), rules: () => svc.rules.getBookingRules(f), analytics: () => svc.analytics.getAnalyticsOverview(f, { from: "2026-10-01", to: "2026-10-31" }) })).toEqual([]);
  });

  it("(a) services/repositories with a forged session pointing at Y: every mutation is refused and Y is byte-identical afterwards", async () => {
    const f = await forged();
    const day = "2026-10-13";
    const attacks: Record<string, () => Promise<unknown>> = {
      createClient: () => svc.clients.createClient(f, { name: "Injected", email: "", phone: "", tags: [], notes: "" }),
      updateClient: () => svc.clients.updateClient(f, Y().client.id, { name: "HACKED" }),
      createService: () => svc.services.createService(f, { name: "Injected", durationMinutes: 30, price: 1, currency: "EUR" } as never),
      updateService: () => svc.services.updateService(f, Y().service.id, { name: "HACKED" }),
      removeService: () => svc.services.removeService(f, Y().service.id),
      createStaff: () => svc.staff.createStaff(f, { name: "Injected" }),
      updateStaff: () => svc.staff.updateStaff(f, Y().staff.id, { name: "HACKED" }),
      deactivateStaff: () => svc.staff.setStaffActive(f, Y().staff.id, false),
      createResource: () => svc.resources.createResource(f, { name: "Injected", type: "room" }),
      updateResource: () => svc.resources.updateResource(f, Y().resource.id, { name: "HACKED" }),
      deactivateResource: () => svc.resources.setResourceActive(f, Y().resource.id, false),
      createTimeOff: () => svc.hours.createTimeOff(f, { staffId: null, startDate: "2026-11-02", endDate: "2026-11-03", reason: "injected" } as never),
      deleteTimeOff: () => svc.hours.deleteTimeOff(f, Y().timeOff.id),
      replaceBusinessHours: () => svc.hours.replaceBusinessWorkingHours(f, {} as never),
      createAppointment: () => svc.appts.createAppointment(f, { client: "Injected", clientId: Y().client.id, service: Y().service.name, serviceId: Y().service.id, staff: Y().staff.name, staffId: Y().staff.id, resourceId: null, date: day, time: "11:00", durationMinutes: 60, price: 1, currency: "EUR", notes: "", visibility: "normal", financialBucket: "main", status: "confirmed", paid: false } as never),
      moveAppointment: () => svc.appts.moveAppointment(f, { id: Y().appointment.id, date: day, time: "14:00" }),
      cancelAppointment: () => svc.appts.cancelAppointment(f, Y().appointment.id),
      removeAppointment: () => svc.appts.removeAppointment(f, Y().appointment.id),
      createLead: () => svc.work.createLead(f, { title: "Injected" } as never),
      updateLead: () => svc.work.updateLead(f, Y().lead.id, { title: "HACKED" }),
      createQuote: () => svc.work.createQuote(f, { title: "Injected" } as never),
      updateQuote: () => svc.work.updateQuote(f, Y().quote.id, { title: "HACKED" }),
      createJob: () => svc.work.createJob(f, { title: "Injected" } as never),
      updateJob: () => svc.work.updateJob(f, Y().job.id, { title: "HACKED" }),
      createProject: () => svc.work.createProject(f, { title: "Injected" } as never),
      updateProject: () => svc.work.updateProject(f, Y().project.id, { title: "HACKED" }),
      archiveLead: () => svc.work.archiveWork(f, "lead", Y().lead.id),
      archiveProject: () => svc.work.archiveWork(f, "project", Y().project.id),
      convertLeadToQuote: () => svc.work.convertLeadToQuote(f, Y().lead.id),
      acceptQuoteCreateJob: () => svc.work.acceptQuoteCreateJob(f, Y().quote.id),
      createProjectForJob: () => svc.work.createProjectForJob(f, Y().job.id),
      attachJobToProject: () => svc.work.attachJobToProject(f, Y().job.id, Y().project.id),
      createInvoice: () => svc.fin.createInvoice(f, { client: "Injected", items: [{ description: "x", quantity: 1, unitPrice: 1 }], bucket: "main", visibility: "normal" } as never),
      updateInvoice: () => svc.fin.updateInvoice(f, { id: Y().invoice.id, notes: "HACKED" }),
      markInvoicePaid: () => svc.fin.updateInvoiceStatus(f, { id: Y().invoice.id, status: "paid" }),
      cancelInvoice: () => svc.fin.updateInvoiceStatus(f, { id: Y().privInvoice.id, status: "cancelled" }),
      recordPaymentMain: () => svc.fin.recordPayment(f, { id: Y().invoice.id, amount: 10, method: "cash" }),
      recordPaymentPrivate: () => svc.fin.recordPayment(f, { id: Y().privInvoice.id, amount: 10, method: "cash" }),
      addWaiting: () => svc.wl.addWaitingListEntry(f, { client: "Injected", service: "x", earliestDate: day, latestDate: "2026-10-30" } as never),
      updateWaiting: () => svc.wl.updateWaitingListEntry(f, Y().waiting.id, { notes: "HACKED" }),
      closeWaiting: () => svc.wl.setWaitingListStatus(f, Y().waiting.id, "closed"),
      recordInboxEvent: () => svc.inbox.recordInboxEvent(f, { type: "system", title: "Injected", dedupeKey: "injected" }),
      markInboxRead: () => svc.inbox.setInboxEventRead(f, Y().event, true),
      markAllInboxRead: () => svc.inbox.markAllInboxEventsRead(f),
      updateProfile: () => svc.profile.updateBusinessProfile(f, { name: "HACKED", industry: "x", description: "", phone: "", email: "", website: "", addressLine1: "", postalCode: "", city: "", country: "", timezone: "Europe/Berlin", currency: "EUR", publicBookingEnabled: false, discoverable: false } as never),
      updateRules: () => svc.rules.updateBookingRules(f, { autoConfirm: true, minNoticeMinutes: 0, maxHorizonDays: 10, slotIntervalMinutes: 15, cancellationDeadlineHours: 0, rescheduleDeadlineHours: 0 }),
      completeOnboarding: () => svc.onboarding.completeOnboarding(f, { industry: "x", bookingMode: "appointments", services: [{ name: "Injected", durationMinutes: 5, price: 1 }], useDefaultHours: true }),
    };
    expect(await survivors(attacks)).toEqual([]);
    expect(await snapshot(T[y].ws)).toBe(before);
  });

  it("(b) direct user-scoped table access: Y's rows are invisible, un-updatable, un-deletable, and nothing can be planted in Y", async () => {
    const c = userClient(T[x].userId);
    for (const t of await w.tenantTables()) {
      const mine = await c.from(t).select("*");
      const rows = (mine.data as { workspace_id: string }[] | null) ?? []; // a table closed to users altogether (error) is fine too
      expect(rows.every((r) => r.workspace_id === T[x].ws), `${t} leaks rows of another workspace`).toBe(true);
      expect(((await c.from(t).select("*").eq("workspace_id", T[y].ws)).data as unknown[] | null) ?? []).toEqual([]);
      // steal / move rows into X, and delete Y's rows
      const moved = await c.from(t).update({ workspace_id: T[x].ws }).eq("workspace_id", T[y].ws).select("workspace_id");
      expect(((moved.data as unknown[] | null) ?? []).length, `${t} update`).toBe(0);
      await c.from(t).delete().eq("workspace_id", T[y].ws);
    }
    expect(((await c.from("workspaces").select("id")).data as { id: string }[]).map((r) => r.id)).toEqual([T[x].ws]);
    expect(((await c.from("workspaces").update({ name: "HACKED", discoverable: true }).eq("id", T[y].ws).select("id")).data as unknown[]).length).toBe(0);
    await c.from("workspaces").delete().eq("id", T[y].ws);
    // plant rows in Y
    const plants: [string, Record<string, unknown>][] = [
      ["clients", { workspace_id: T[y].ws, name: "Injected" }],
      ["services", { workspace_id: T[y].ws, name: "Injected", duration_minutes: 30, price: 1 }],
      ["staff_profiles", { workspace_id: T[y].ws, name: "Injected" }],
      ["resources", { workspace_id: T[y].ws, name: "Injected", type: "room" }],
      ["leads", { workspace_id: T[y].ws, title: "Injected" }],
      ["time_off", { workspace_id: T[y].ws, start_date: "2026-11-02", end_date: "2026-11-02" }],
      ["workspace_members", { workspace_id: T[y].ws, profile_id: T[x].userId, role: "owner" }], // privilege escalation into Y
      ["workspaces", { slug: "stolen-slug", name: "Injected" }],
    ];
    for (const [t, row] of plants) expect((await c.from(t).insert(row)).error, `insert into ${t}`).not.toBeNull();
    expect(await w.q("select 1 from workspaces where slug = 'stolen-slug'")).toEqual([]);
    expect(await snapshot(T[y].ws)).toBe(before);
    // control: the same user CAN update their own rows
    const own = await c.from("clients").update({ notes: "own edit" }).eq("id", X().client.id).select("id");
    expect((own.data as unknown[]).length).toBe(1);
  });

  it("(b) Y's owner profile (e-mail) is not readable by X, and X is not a member of Y", async () => {
    const c = userClient(T[x].userId);
    const profiles = ((await c.from("profiles").select("id,email")).data as { id: string }[]) ?? [];
    expect(profiles.map((p) => p.id)).not.toContain(T[y].userId);
    const mem = ((await c.from("workspace_members").select("workspace_id")).data as { workspace_id: string }[]) ?? [];
    expect(mem.map((m) => m.workspace_id)).toEqual([T[x].ws]);
  });

  it("(c) RPCs run as X with Y's workspace / ids are all refused; Y is byte-identical afterwards", async () => {
    const c = userClient(T[x].userId);
    const item = [{ description: "x", quantity: 1, unit_price: 1 }];
    const calls: [string, Record<string, unknown>][] = [
      ["analytics_overview", { p_workspace_id: T[y].ws, p_from: "2026-10-01", p_to: "2026-10-31" }],
      ["create_invoice", { p_workspace_id: T[y].ws, p_client_name: "Injected", p_items: item }],
      ["next_invoice_number", { p_workspace_id: T[y].ws }],
      ["convert_lead_to_quote", { p_lead_id: Y().lead.id }],
      ["accept_quote_create_job", { p_quote_id: Y().quote.id }],
      ["create_project_for_job", { p_job_id: Y().job.id }],
      ["attach_job_to_project", { p_job_id: Y().job.id, p_project_id: Y().project.id }],
      ["attach_job_to_project", { p_job_id: X().job.id, p_project_id: Y().project.id }],
      ["replace_quote_items", { p_quote_id: Y().quote.id, p_items: item }],
      ["replace_working_hours", { p_workspace_id: T[y].ws, p_staff_id: null, p_rows: [{ weekday: 1, start_time: "00:00", end_time: "23:00", is_day_off: false }] }],
      ["record_inbox_event", { p_workspace_id: T[y].ws, p_type: "system", p_code: "", p_title: "Injected", p_preview: "", p_entity_type: "", p_entity_id: "", p_client_id: null, p_dedupe_key: "inj" }],
      ["record_inbox_event", { p_workspace_id: T[y].ws, p_type: "waiting_list", p_code: "", p_title: "Injected", p_preview: "", p_entity_type: "", p_entity_id: "", p_client_id: null, p_dedupe_key: "inj2" }],
      ["replace_invoice_items", { p_invoice_id: Y().invoice.id, p_items: item }],
      ["record_payment", { p_invoice_id: Y().invoice.id, p_amount: 5 }],
      ["record_payment", { p_invoice_id: Y().privInvoice.id, p_amount: 5 }],
      ["void_invoice_payments", { p_invoice_id: Y().invoice.id }],
      ["cancel_invoice", { p_invoice_id: Y().invoice.id }],
      ["list_invoice_items", { p_workspace_id: T[y].ws }],
      ["list_masked_appointments", { p_workspace_id: T[y].ws }],
      ["resolve_financial_bucket", { p_workspace_id: T[y].ws, p_kind: "main", p_bucket_id: null }],
      ["complete_onboarding", { p_workspace_id: T[y].ws, p_industry: "x", p_booking_mode: "appointments", p_services: [{ name: "Injected" }], p_use_default_hours: true }],
    ];
    const ok: string[] = [];
    for (const [name, args] of calls) {
      const r = await c.rpc(name, args);
      const empty = Array.isArray(r.data) && r.data.length === 0;
      if (!r.error && !empty) ok.push(`${name}(${Object.keys(args)[0]})`);
    }
    expect(ok).toEqual([]);
    expect(await snapshot(T[y].ws)).toBe(before);
    // controls: the same RPCs work for X on X's own workspace
    expect((await c.rpc("analytics_overview", { p_workspace_id: T[x].ws, p_from: "2026-10-01", p_to: "2026-10-31" })).error).toBeNull();
    expect((await c.rpc("next_invoice_number", { p_workspace_id: T[x].ws })).error).toBeNull();
  });

  it("(c) service-role-only RPCs (client accounts, public booking, provisioning, directory) are closed to X and to anonymous callers", async () => {
    const serviceOnly: [string, Record<string, unknown>][] = [
      ["list_my_bookings", { p_user_id: T[y].userId, p_limit: 50 }],
      ["claim_booking", { p_user_id: T[x].userId, p_token: "a".repeat(64) }],
      ["cancel_my_booking", { p_user_id: T[y].userId, p_appointment_id: Y().appointment.id }],
      ["issue_booking_claim", { p_appointment_id: Y().appointment.id }],
      ["get_public_booking_catalog", { p_slug: T[y].slug }],
      ["list_discoverable_businesses", { p_limit: 50, p_offset: 0 }],
      ["provision_workspace", { p_user_id: T[x].userId, p_email: "x@t.invalid", p_full_name: "", p_business_name: "Evil", p_base_slug: "evil", p_locale: "en" }],
    ];
    for (const client of [userClient(T[x].userId), anonClient()]) {
      for (const [name, args] of serviceOnly) {
        const r = await client.rpc(name, args);
        expect(r.error, `${name} must be denied`).not.toBeNull();
      }
    }
    expect(await snapshot(T[y].ws)).toBe(before);
  });

  it("(d) foreign keys across workspaces: Y's client/service/staff/bucket/appointment ids inside X's rows are refused (service layer)", async () => {
    const s = await own();
    const day = ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21"][PAIRS.findIndex(([a, b]) => a === x && b === y)];
    const foreignAppt = (over: Record<string, unknown>) => ({
      client: X().client.name, clientId: X().client.id, service: X().service.name, serviceId: X().service.id, staff: X().staff.name, staffId: X().staff.id,
      resourceId: null, date: day, time: "11:00", durationMinutes: 60, price: 1, currency: "EUR", notes: "", visibility: "normal", financialBucket: "main", status: "confirmed", paid: false, ...over,
    });
    const inv = (over: Record<string, unknown>) => ({ client: "FK", items: [{ description: "x", quantity: 1, unitPrice: 1 }], bucket: "main", visibility: "normal", ...over });
    // controls first: with X's own ids the very same calls succeed, so the refusals below are about the foreign id only
    const control = await svc.appts.createAppointment(s, foreignAppt({}) as never);
    expect(control.id).toBeTruthy();
    expect((await svc.fin.createInvoice(s, inv({ clientId: X().client.id, financialBucketId: X().mainBucket }) as never)).id).toBeTruthy();

    expect(await svc.inbox.recordInboxEvent(s, { type: "system", title: "FK", clientId: X().client.id, dedupeKey: `fk-own-${x}-${y}` })).toBe(true);

    const attacks: Record<string, () => Promise<unknown>> = {
      "appointment.client": () => svc.appts.createAppointment(s, foreignAppt({ clientId: Y().client.id, time: "12:00" }) as never),
      "appointment.service": () => svc.appts.createAppointment(s, foreignAppt({ serviceId: Y().service.id, time: "12:30" }) as never),
      "appointment.staff": () => svc.appts.createAppointment(s, foreignAppt({ staffId: Y().staff.id, time: "13:00" }) as never),
      "appointment.resource": () => svc.appts.createAppointment(s, foreignAppt({ resourceId: Y().resource.id, time: "13:30" }) as never),
      "appointment.bucket": () => svc.appts.createAppointment(s, foreignAppt({ financialBucketId: Y().mainBucket, time: "14:00" }) as never),
      "appointment.update.client": () => svc.appts.updateAppointment(s, X().appointment.id, { clientId: Y().client.id } as never),
      "invoice.client": () => svc.fin.createInvoice(s, inv({ clientId: Y().client.id }) as never),
      "invoice.bucket": () => svc.fin.createInvoice(s, inv({ financialBucketId: Y().mainBucket }) as never),
      "invoice.privateBucket": () => svc.fin.createInvoice(s, inv({ bucket: "private", visibility: "private", financialBucketId: Y().privateBucket }) as never),
      "invoice.appointment": () => svc.fin.createInvoice(s, inv({ appointmentId: Y().appointment.id }) as never),
      "invoice.update.client": () => svc.fin.updateInvoice(s, { id: X().invoice.id, clientId: Y().client.id }),
      "payment.foreignInvoice": () => svc.fin.recordPayment(s, { id: Y().invoice.id, amount: 1, method: "cash" }),
      "lead.client": () => svc.work.createLead(s, { title: "FK", clientId: Y().client.id } as never),
      "lead.bucket": () => svc.work.createLead(s, { title: "FK", financialBucketId: Y().mainBucket } as never),
      "quote.client": () => svc.work.createQuote(s, { title: "FK", clientId: Y().client.id } as never),
      "job.client": () => svc.work.createJob(s, { title: "FK", clientId: Y().client.id } as never),
      "job.project": () => svc.work.createJob(s, { title: "FK", projectId: Y().project.id } as never),
      "job.staff": () => svc.work.createJob(s, { title: "FK", staffId: Y().staff.id } as never),
      "job.update.project": () => svc.work.updateJob(s, X().job.id, { projectId: Y().project.id }),
      "project.client": () => svc.work.createProject(s, { title: "FK", clientId: Y().client.id } as never),
      "attachJobToProject": () => svc.work.attachJobToProject(s, X().job.id, Y().project.id),
      "waiting.client": () => svc.wl.addWaitingListEntry(s, { client: "FK", clientId: Y().client.id, serviceId: X().service.id, earliestDate: day, latestDate: "2026-10-30" } as never),
      "waiting.service": () => svc.wl.addWaitingListEntry(s, { client: "FK", serviceId: Y().service.id, earliestDate: day, latestDate: "2026-10-30" } as never),
      "waiting.staff": () => svc.wl.addWaitingListEntry(s, { client: "FK", serviceId: X().service.id, preferredStaffId: Y().staff.id, earliestDate: day, latestDate: "2026-10-30" } as never),
      "timeOff.staff": () => svc.hours.createTimeOff(s, { staffId: Y().staff.id, startDate: "2026-11-02", endDate: "2026-11-02" } as never),
      "staff.services": () => svc.staff.createStaff(s, { name: "FK", serviceIds: [Y().service.id] }),
      "service.staff": () => svc.services.createService(s, { name: "FK", durationMinutes: 30, price: 1, allowedStaffIds: [Y().staff.id] } as never),
      "staff.hours": () => svc.hours.replaceStaffWorkingHours(s, Y().staff.id, {} as never),
      "inbox.client": () => svc.inbox.recordInboxEvent(s, { type: "system", title: "FK", clientId: Y().client.id, dedupeKey: `fk-${x}-${y}` }).then((r) => (r ? { stored: true } : false)),
    };
    const alive = await survivors(attacks);
    expect(alive).toEqual([]);
    // none of X's rows ended up referencing Y
    for (const [table, col, ref] of [
      ["appointments", "client_id", "clients"], ["appointments", "service_id", "services"], ["appointments", "staff_id", "staff_profiles"],
      ["invoices", "client_id", "clients"], ["invoices", "financial_bucket_id", "financial_buckets"], ["leads", "client_id", "clients"],
      ["jobs", "project_id", "projects"], ["waiting_list", "service_id", "services"],
    ] as const) {
      const bad = await w.q(`select 1 from public."${table}" t join public."${ref}" r on r.id = t."${col}" where t.workspace_id = $1 and r.workspace_id <> t.workspace_id`, [T[x].ws]);
      expect(bad, `${table}.${col}`).toEqual([]);
    }
    expect(await snapshot(T[y].ws)).toBe(before);
  });

  it("(d) the database itself refuses cross-workspace references even with full rights (triggers, no RLS in the way)", async () => {
    // (table, id of X's row, column, Y's foreign id, X's own id for the positive control)
    const cases: [string, string, string, string, string][] = [
      ["appointments", X().appointment.id, "client_id", Y().client.id, X().client.id],
      ["appointments", X().appointment.id, "service_id", Y().service.id, X().service.id],
      ["appointments", X().appointment.id, "staff_id", Y().staff.id, X().staff.id],
      ["appointments", X().appointment.id, "resource_id", Y().resource.id, X().resource.id],
      ["appointments", X().appointment.id, "financial_bucket_id", Y().mainBucket, X().mainBucket],
      ["invoices", X().invoice.id, "client_id", Y().client.id, X().client.id],
      ["invoices", X().invoice.id, "financial_bucket_id", Y().mainBucket, X().mainBucket],
      ["invoices", X().invoice.id, "appointment_id", Y().appointment.id, X().appointment.id],
      ["leads", X().lead.id, "client_id", Y().client.id, X().client.id],
      ["quotes", X().quote.id, "lead_id", Y().lead.id, X().lead.id],
      ["quotes", X().quote.id, "client_id", Y().client.id, X().client.id],
      ["jobs", X().job.id, "project_id", Y().project.id, X().project.id],
      ["jobs", X().job.id, "quote_id", Y().quote.id, X().quote.id],
      ["jobs", X().job.id, "responsible_staff_id", Y().staff.id, X().staff.id],
      ["projects", X().project.id, "client_id", Y().client.id, X().client.id],
      ["waiting_list", X().waiting.id, "service_id", Y().service.id, X().service.id],
      ["waiting_list", X().waiting.id, "preferred_staff_id", Y().staff.id, X().staff.id],
      ["waiting_list", X().waiting.id, "client_id", Y().client.id, X().client.id],
      ["time_off", X().timeOff.id, "staff_id", Y().staff.id, X().staff.id],
      ["payments", (await w.q<{ id: string }>("select id from payments where workspace_id = $1 limit 1", [T[x].ws]))[0].id, "invoice_id", Y().invoice.id, X().invoice.id],
    ];
    for (const [table, id, col, foreign, mine] of cases) {
      const upd = () => `update public."${table}" set "${col}" = $1 where id = $2`;
      await db.exec("begin");
      try {
        await db.query(upd(), [mine, id]); // control: own id is accepted
      } finally {
        await db.exec("rollback");
      }
      await db.exec("begin");
      let failed = false;
      try {
        await db.query(upd(), [foreign, id]);
      } catch {
        failed = true;
      } finally {
        await db.exec("rollback");
      }
      expect(failed, `${table}.${col} accepted a reference into another workspace`).toBe(true);
    }
    expect(await snapshot(T[y].ws)).toBe(before);
  });
});
