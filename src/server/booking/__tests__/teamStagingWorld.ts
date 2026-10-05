import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import type { BusinessAuthProvider } from "@/server/auth/businessAuth";

/**
 * Shared fixture for the team-staging verification tests (multi-workspace, discovery, onboarding).
 * Real PostgreSQL (PGlite, every migration), the Supabase shim, REAL services. The test files mock
 * `@/lib/supabase/server` / `@/lib/supabase/admin` to hand out `holder.user` / `holder.admin`.
 */
export const holder: { user: SupabaseClient | null; admin: SupabaseClient | null } = { user: null, admin: null };

export interface Tenant {
  userId: string;
  email: string;
  ws: string;
  slug: string;
}

export function makeTeamWorld(db: PGlite) {
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
  const svc = () => createPgliteSupabaseClient(db, { kind: "service" });
  const asUser = (id: string) => (holder.user = createPgliteSupabaseClient(db, { kind: "user", id }));
  holder.admin = svc();

  async function user(label: string): Promise<string> {
    const id = randomUUID();
    const email = `${label}-${id.slice(0, 6)}@t.invalid`;
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    await db.query("insert into profiles (id, email) values ($1, $2) on conflict do nothing", [id, email]);
    return id;
  }

  /** A Business Auth provider that creates real auth.users rows in PGlite (the part Supabase Auth would do). */
  function fakeAuth(): BusinessAuthProvider & { created: { id: string; email: string }[] } {
    const created: { id: string; email: string }[] = [];
    return {
      created,
      async signUpWithPassword(email: string) {
        const id = randomUUID();
        await db.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
        created.push({ id, email });
        return { ok: true as const, userId: id, hasSession: true };
      },
      signInWithPassword: async () => ({ ok: false as const, code: "unknown" as const }),
      signOut: async () => undefined,
      getCurrentUserId: async () => null,
      discardUser: async (id: string) => void (await db.query("delete from auth.users where id = $1", [id])),
    };
  }

  /** Real sign-up path: signUpOwner -> provision_workspace. */
  async function signUp(businessName: string, email: string, locale: "en" | "de" | "uk" | "ru" = "en"): Promise<Tenant> {
    const { signUpOwner } = await import("@/server/services/provisioning.service");
    const auth = fakeAuth();
    const r = await signUpOwner(auth, { businessName, email, password: "correct-horse-battery" }, locale);
    if (!r.ok || r.outcome !== "signed_in") throw new Error(`sign-up failed: ${JSON.stringify(r)}`);
    const u = auth.created[0];
    const ws = (await q<{ id: string }>("select id from workspaces where slug = $1", [r.workspaceSlug]))[0].id;
    return { userId: u.id, email: u.email, ws, slug: r.workspaceSlug };
  }

  /** The real session resolver, as the given user, under RLS. */
  async function session(userId: string, slug: string) {
    const { getSession } = await import("@/server/auth/session");
    asUser(userId);
    return getSession(slug);
  }

  async function member(ws: string, role: "admin" | "manager" | "staff" | "accountant" | "owner", label = role): Promise<string> {
    const id = await user(label);
    await q("insert into workspace_members (workspace_id, profile_id, role) values ($1,$2,$3)", [ws, id, role]);
    return id;
  }

  /** Every public table that carries a workspace_id column. */
  async function tenantTables(): Promise<string[]> {
    return (
      await q<{ table_name: string }>(
        `select c.table_name from information_schema.columns c
           join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
          where c.table_schema = 'public' and c.column_name = 'workspace_id' and t.table_type = 'BASE TABLE'
          order by 1`,
      )
    ).map((r) => r.table_name);
  }

  /** Non-empty tenant tables of one workspace: { table: rowCount }. */
  async function footprint(ws: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of await tenantTables()) {
      const n = Number((await q<{ n: string }>(`select count(*)::text n from public."${t}" where workspace_id = $1`, [ws]))[0].n);
      if (n > 0) out[t] = n;
    }
    return out;
  }

  /**
   * What the business app would show this session, through the REAL services/repositories (RLS as the
   * user in `holder.user`). Counts per module; used to prove "clean start" and "no foreign rows".
   */
  async function readAll(s: Awaited<ReturnType<typeof session>>) {
    const [cl, ap, sv, inv, le, qu, jo, pr, wl, ib, to, st, rs, wh] = await Promise.all([
      import("@/server/services/clients.service").then((m) => m.listClients(s)),
      import("@/server/services/appointments.service").then((m) => m.listAppointments(s)),
      import("@/server/services/services.service").then((m) => m.listServices(s)),
      import("@/server/services/finance.service").then((m) => m.listInvoices(s)),
      import("@/server/services/work.service").then((m) => m.listLeads(s)),
      import("@/server/services/work.service").then((m) => m.listQuotes(s)),
      import("@/server/services/work.service").then((m) => m.listJobs(s)),
      import("@/server/services/work.service").then((m) => m.listProjects(s)),
      import("@/server/services/waitingList.service").then((m) => m.listWaitingList(s)),
      import("@/server/services/inbox.service").then((m) => m.listInboxEvents(s)),
      import("@/server/services/workingHours.service").then((m) => m.listTimeOff(s)),
      import("@/server/services/staffAdmin.service").then((m) => m.listStaffAdmin(s)),
      import("@/server/services/resourcesAdmin.service").then((m) => m.listResourcesAdmin(s)),
      import("@/server/services/workingHours.service").then((m) => m.getWorkingHours(s)),
    ]);
    return {
      clients: cl, appointments: ap, services: sv, invoices: inv, leads: le, quotes: qu, jobs: jo, projects: pr,
      waiting: wl, inbox: ib.events, timeOff: to, staff: st, resources: rs, hours: wh,
    };
  }

  /**
   * Gives one tenant data in EVERY module, through the real services as its owner. Names carry `tag`
   * so a leak is recognisable. Business hours: Mon-Fri 09:00-17:00.
   */
  async function seedAll(t: Tenant, tag: string) {
    const s = await session(t.userId, t.slug);
    const [svcM, staffM, resM, hoursM, clientsM, apptM, workM, finM, wlM, inboxM, analyticsM] = await Promise.all([
      import("@/server/services/services.service"),
      import("@/server/services/staffAdmin.service"),
      import("@/server/services/resourcesAdmin.service"),
      import("@/server/services/workingHours.service"),
      import("@/server/services/clients.service"),
      import("@/server/services/appointments.service"),
      import("@/server/services/work.service"),
      import("@/server/services/finance.service"),
      import("@/server/services/waitingList.service"),
      import("@/server/services/inbox.service"),
      import("@/server/services/analytics.service"),
    ]);
    const service = await svcM.createService(s, { name: `Service ${tag}`, durationMinutes: 60, price: 80, currency: "EUR" } as never);
    await staffM.createStaff(s, { name: `Staff ${tag}`, serviceIds: [service.id] });
    const resource = await resM.createResource(s, { name: `Room ${tag}`, type: "room" });
    const week = Object.fromEntries([1, 2, 3, 4, 5].map((d) => [String(d), [{ start: "09:00", end: "17:00" }]]));
    await hoursM.replaceBusinessWorkingHours(s, week as never);
    const timeOff = await hoursM.createTimeOff(s, { staffId: null, startDate: "2026-12-24", endDate: "2026-12-26", reason: `holiday ${tag}` } as never);
    const client = await clientsM.createClient(s, { name: `Client ${tag}`, email: `client-${tag.toLowerCase()}@example.test`, phone: "+49 30 0000", tags: [], notes: `note ${tag}` });
    const myStaff = (await staffM.listStaffAdmin(s)).find((x) => x.name === `Staff ${tag}`)!;
    const appointment = await apptM.createAppointment(s, {
      client: client.name, clientId: client.id, service: service.name, serviceId: service.id, staff: myStaff.name, staffId: myStaff.id,
      resourceId: null, date: "2026-10-12", time: "10:00", durationMinutes: 60, price: 80, currency: "EUR", notes: "",
      visibility: "normal", financialBucket: "main", status: "confirmed", paid: false,
    } as never);
    const lead = await workM.createLead(s, { title: `Lead ${tag}`, clientName: client.name, clientId: client.id } as never);
    const quote = await workM.createQuote(s, { title: `Quote ${tag}`, clientName: client.name, clientId: client.id, amount: 500 } as never);
    const job = await workM.createJob(s, { title: `Job ${tag}`, clientName: client.name, clientId: client.id, amount: 300 } as never);
    const project = await workM.createProject(s, { title: `Project ${tag}`, clientName: client.name, clientId: client.id } as never);
    const invoice = await finM.createInvoice(s, { client: client.name, clientId: client.id, items: [{ description: `Main ${tag}`, quantity: 1, unitPrice: 100 }], bucket: "main", visibility: "normal" } as never);
    await finM.recordPayment(s, { id: invoice.id, amount: 40, method: "cash" });
    const privInvoice = await finM.createInvoice(s, { client: `Private ${tag}`, items: [{ description: `Private ${tag}`, quantity: 1, unitPrice: 60 }], bucket: "private", visibility: "private" } as never);
    await finM.recordPayment(s, { id: privInvoice.id, amount: 20, method: "cash" });
    const waiting = await wlM.addWaitingListEntry(s, { client: client.name, clientId: client.id, serviceId: service.id, earliestDate: "2026-10-12", latestDate: "2026-10-30" } as never);
    await inboxM.recordInboxEvent(s, { type: "system", title: `Event ${tag}`, dedupeKey: `seed:${tag}` });
    const analytics = await analyticsM.getAnalyticsOverview(s, { from: "2026-10-01", to: "2026-10-31" });
    const bucket = async (kind: string) => (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind=$2", [t.ws, kind]))[0].id;
    const event = (await q<{ id: string }>("select id from inbox_events where workspace_id=$1 and dedupe_key=$2", [t.ws, `seed:${tag}`]))[0].id;
    return {
      session: s, service, staff: myStaff, resource, timeOff, client, appointment, lead, quote, job, project, invoice, privInvoice, waiting,
      event, analytics, mainBucket: await bucket("main"), privateBucket: await bucket("private"),
    };
  }

  return { db, q, svc, asUser, user, fakeAuth, signUp, session, member, tenantTables, footprint, readAll, seedAll };
}
export type TeamWorld = ReturnType<typeof makeTeamWorld>;
