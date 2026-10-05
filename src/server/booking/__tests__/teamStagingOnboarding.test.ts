import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { makeTeamWorld, type TeamWorld, type Tenant } from "./teamStagingWorld";

// Team staging, part 1: a business owner signs up (REAL provisioning service + RPC, fake auth provider) and
// starts from a CLEAN workspace; then finishes onboarding. Real PostgreSQL (PGlite, migrations 0001-0024).
vi.mock("@/lib/supabase/server", async () => ({ createSupabaseServerClient: async () => (await import("./teamStagingWorld")).holder.user }));
vi.mock("@/lib/supabase/admin", async () => ({ createSupabaseAdminClient: () => ({ rpc: async (n: string, a: Record<string, unknown>) => (await import("./teamStagingWorld")).holder.admin!.rpc(n, a) }) }));
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";

const { completeOnboarding } = await import("@/server/services/onboarding.service");
const { getWorkspaceConfig } = await import("@/features/workspace/registry");
const { PermissionDeniedError } = await import("@/server/permissions/roles");

/** The ONLY rows a brand-new workspace may own: owner membership, two buckets, the owner's staff row, a week of hours. */
const MINIMAL = { financial_buckets: 2, staff_profiles: 1, working_hours: 7, workspace_members: 1 };

let db: PGlite;
let w: TeamWorld;
let busy: Tenant;
const fresh: Tenant[] = [];

beforeAll(async () => {
  db = await createMigratedDb();
  w = makeTeamWorld(db);
  // A workspace that is full of data exists BEFORE the newcomers sign up: none of it may show up for them.
  busy = await w.signUp("Busy Studio", "busy@t.invalid");
  await w.seedAll(busy, "BUSY");
  fresh.push(await w.signUp("Fresh Salon", "owner1@t.invalid", "de"));
  fresh.push(await w.signUp("Fresh Salon", "owner2@t.invalid", "en")); // SAME business name
  fresh.push(await w.signUp("Fresh Salon", "owner3@t.invalid", "uk")); // and again
}, 120_000);
afterAll(async () => db.close());

describe("sign-up: slug allocation and workspace defaults", () => {
  it("the same business name three times yields three distinct, valid, public-safe slugs", () => {
    const slugs = fresh.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(3);
    expect(slugs[0]).toBe("fresh-salon"); // first one gets the clean slug
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slugs[1]).toMatch(/^fresh-salon-[0-9a-f]{4}$/);
    expect(slugs[2]).toMatch(/^fresh-salon-[0-9a-f]{4}$/);
  });

  it("a business named like a demo preset never gets a demo-* slug", async () => {
    const t = await w.signUp("Demo Salon", "demo-name@t.invalid");
    expect(t.slug.startsWith("demo-")).toBe(false);
    expect(t.slug).toMatch(/^workspace/);
  });

  it("each owner has exactly one membership: owner, in their own workspace only", async () => {
    for (const f of fresh) {
      const rows = await w.q<{ workspace_id: string; role: string }>("select workspace_id, role::text from workspace_members where profile_id = $1", [f.userId]);
      expect(rows).toEqual([{ workspace_id: f.ws, role: "owner" }]);
      expect((await w.q("select 1 from workspace_members where workspace_id = $1 and profile_id <> $2", [f.ws, f.userId])).length).toBe(0);
    }
  });

  it("owner profile carries the sign-up locale; workspace gets neutral defaults", async () => {
    const locales = await Promise.all(fresh.map(async (f) => (await w.q<{ locale: string }>("select locale from profiles where id = $1", [f.userId]))[0].locale));
    expect(locales).toEqual(["de", "en", "uk"]);
    for (const f of fresh) {
      const ws = (await w.q<Record<string, unknown>>("select * from workspaces where id = $1", [f.ws]))[0];
      expect(ws).toMatchObject({
        name: "Fresh Salon", timezone: "Europe/Berlin", default_currency: "EUR",
        public_booking_enabled: true, discoverable: false, onboarding_completed_at: null, created_by: f.userId,
      });
    }
  });
});

describe("clean start: nothing but the minimal defaults", () => {
  it("every tenant table of a new workspace holds exactly the minimal rows", async () => {
    expect((await w.tenantTables()).length).toBeGreaterThanOrEqual(20); // the check really walks every tenant table
    for (const f of fresh) expect(await w.footprint(f.ws)).toEqual(MINIMAL);
  });

  it("the defaults are what the docs promise: main + private buckets, a 'You' staff row, Mon-Fri 09-18", async () => {
    for (const f of fresh) {
      expect(await w.q("select slug, kind::text, is_default from financial_buckets where workspace_id = $1 order by slug", [f.ws])).toEqual([
        { slug: "main", kind: "main", is_default: true },
        { slug: "private", kind: "private", is_default: false },
      ]);
      expect(await w.q("select name, profile_id, active from staff_profiles where workspace_id = $1", [f.ws])).toEqual([{ name: "You", profile_id: f.userId, active: true }]);
      const hours = await w.q<{ weekday: number; start_time: string | null; end_time: string | null; is_day_off: boolean; staff_id: string | null }>(
        "select weekday, start_time, end_time, is_day_off, staff_id from working_hours where workspace_id = $1 order by weekday", [f.ws],
      );
      expect(hours.map((h) => h.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(hours.every((h) => h.staff_id === null)).toBe(true);
      expect(hours.filter((h) => !h.is_day_off).map((h) => `${h.start_time}-${h.end_time}`)).toEqual(Array(5).fill("09:00:00-18:00:00"));
      expect(hours.filter((h) => h.is_day_off).map((h) => h.weekday)).toEqual([0, 6]);
    }
  });

  it("through the real services every module is empty for the new owner (no demo fixture, no other workspace's rows)", async () => {
    for (const f of fresh) {
      const all = await w.readAll(await w.session(f.userId, f.slug));
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
      expect(all.staff.map((s) => s.name)).toEqual(["You"]);
      expect(JSON.stringify(all)).not.toMatch(/BUSY/);
    }
  });

  it("the new workspace never falls back to demo config (empty catalog for a real slug)", () => {
    for (const f of fresh) {
      const cfg = getWorkspaceConfig(f.slug);
      expect([cfg.clients.length, cfg.appointments.length, cfg.services.length, cfg.staff.length]).toEqual([0, 0, 0, 0]);
    }
  });

  it("analytics for a new workspace are all zero, and the busy workspace's numbers are not included", async () => {
    const { getAnalyticsOverview } = await import("@/server/services/analytics.service");
    const o = await getAnalyticsOverview(await w.session(fresh[0].userId, fresh[0].slug), { from: "2026-10-01", to: "2026-10-31" });
    expect(o.appointments?.total).toBe(0);
    expect(o.newClients).toBe(0);
    expect(JSON.stringify(o)).not.toMatch(/BUSY|Service/);
  });

  it("provisioning is idempotent: a retried sign-up RPC creates nothing new", async () => {
    const f = fresh[0];
    const before = await w.footprint(f.ws);
    const wsCount = (await w.q<{ n: string }>("select count(*)::text n from workspaces"))[0].n;
    const r = await w.svc().rpc("provision_workspace", { p_user_id: f.userId, p_email: f.email, p_full_name: "", p_business_name: "Fresh Salon", p_base_slug: "fresh-salon", p_locale: "en" });
    expect((r.data as { out_workspace_id: string; out_created: boolean }[])[0]).toMatchObject({ out_workspace_id: f.ws, out_created: false });
    expect(await w.footprint(f.ws)).toEqual(before);
    expect((await w.q<{ n: string }>("select count(*)::text n from workspaces"))[0].n).toBe(wsCount);
  });
});

describe("complete_onboarding keeps the workspace clean and tenant-scoped", () => {
  const wizard = (services: { name: string; durationMinutes: number; price: number }[], useDefaultHours = true) =>
    ({ industry: "beauty", bookingMode: "appointments" as const, services, useDefaultHours });

  it("applies once per owner; the services land only in their own workspace; nothing else appears", async () => {
    const plans = [
      [{ name: "Cut", durationMinutes: 45, price: 40 }, { name: "Colour", durationMinutes: 90, price: 120 }],
      [], // no services chosen: nothing must be invented
      [{ name: "Only one", durationMinutes: 30, price: 25 }],
    ];
    for (const [i, f] of fresh.entries()) {
      expect(await completeOnboarding(await w.session(f.userId, f.slug), wizard(plans[i], i !== 2))).toBe(true);
    }
    for (const [i, f] of fresh.entries()) {
      expect(await w.footprint(f.ws)).toEqual({ ...MINIMAL, ...(plans[i].length ? { services: plans[i].length } : {}) });
      const ws = (await w.q<{ industry: string; booking_mode: string; done: boolean }>("select industry, booking_mode, onboarding_completed_at is not null done from workspaces where id = $1", [f.ws]))[0];
      expect(ws).toEqual({ industry: "beauty", booking_mode: "appointments", done: true });
      const all = await w.readAll(await w.session(f.userId, f.slug));
      expect(all.services.map((s) => s.name).sort()).toEqual(plans[i].map((s) => s.name).sort());
      expect([all.clients, all.appointments, all.invoices, all.leads, all.waiting, all.inbox, all.timeOff].map((x) => x.length)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    }
  });

  it("a second completion is a no-op and does not duplicate services or hours", async () => {
    const f = fresh[0];
    const before = await w.footprint(f.ws);
    expect(await completeOnboarding(await w.session(f.userId, f.slug), wizard([{ name: "Dup", durationMinutes: 10, price: 1 }]))).toBe(false);
    expect(await w.footprint(f.ws)).toEqual(before);
  });

  it("one owner cannot complete (or alter) another workspace's onboarding, even with a forged session", async () => {
    const [a, b] = [fresh[1], fresh[2]];
    await w.q("update workspaces set onboarding_completed_at = null, industry = null where id = $1", [b.ws]);
    const forged = { ...(await w.session(a.userId, a.slug)), workspaceId: b.ws };
    await expect(completeOnboarding(forged, wizard([{ name: "Injected", durationMinutes: 10, price: 1 }]))).rejects.toThrow("complete_onboarding failed");
    expect(await w.q("select 1 from services where workspace_id = $1 and name = 'Injected'", [b.ws])).toEqual([]);
    expect((await w.q<{ done: boolean }>("select onboarding_completed_at is not null done from workspaces where id = $1", [b.ws]))[0].done).toBe(false);
    await w.q("update workspaces set onboarding_completed_at = now(), industry = 'beauty' where id = $1", [b.ws]);
  });

  it("a staff member of the workspace cannot run onboarding (settings.manage)", async () => {
    const f = fresh[0];
    const staffUser = await w.member(f.ws, "staff");
    await expect(completeOnboarding(await w.session(staffUser, f.slug), wizard([]))).rejects.toBeInstanceOf(PermissionDeniedError);
  });
});
