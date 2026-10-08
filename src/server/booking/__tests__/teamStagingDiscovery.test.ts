import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { demoWorkspaces } from "@/features/workspace/registry";
import { D, makeWorld, PINNED_NOW, type Biz, type World } from "./schedulingHarness";
import { makeTeamWorld, type TeamWorld, type Tenant } from "./teamStagingWorld";

/**
 * Team staging, part 3: the CLIENT chooses a business. Three real workspaces (signed up through the real
 * provisioning service) with different services / staff / hours / time zones, in every combination of
 * "online booking" x "listed in the directory". Real PGlite database, real services, no mocks of logic.
 */
vi.mock("@/lib/supabase/server", async () => ({ createSupabaseServerClient: async () => (await import("./teamStagingWorld")).holder.user }));
vi.mock("@/lib/supabase/admin", async () => ({ createSupabaseAdminClient: () => ({ rpc: async (n: string, a: Record<string, unknown>) => (await import("./teamStagingWorld")).holder.admin!.rpc(n, a) }) }));
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";

const { listDiscoverableBusinesses } = await import("../discovery.service");
const { loadPublicCatalog, getPublicSlots, createPublicBooking } = await import("../publicBooking.service");
const profileSvc = await import("@/server/services/businessProfile.service");
const apptSvc = await import("@/server/services/appointments.service");
const clientSvc = await import("@/server/services/clients.service");
const inboxSvc = await import("@/server/services/inbox.service");

let db: PGlite;
let tw: TeamWorld;
let w: World;
let alpine: Tenant, brooklyn: Tenant, garage: Tenant, fresh: Tenant;
const biz: Record<string, Biz> = {};
const svcId: Record<string, string> = {};
const staffId: Record<string, string> = {};

const directory = async () => (await listDiscoverableBusinesses({ admin: tw.svc() })).map((b) => b.slug).sort();

/** The owner switches the two public flags in Settings (real service: same rules as the form). */
async function setPublic(t: Tenant, flags: { publicBookingEnabled: boolean; discoverable: boolean }, extra: Record<string, unknown> = {}) {
  const s = await tw.session(t.userId, t.slug);
  await profileSvc.updateBusinessProfile(s, { ...(await profileSvc.getBusinessProfile(s)), ...flags, ...extra });
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(PINNED_NOW));
  db = await createMigratedDb();
  tw = makeTeamWorld(db);
  w = makeWorld(db);
  alpine = await tw.signUp("Alpine Salon", "alpine@t.invalid");
  brooklyn = await tw.signUp("Brooklyn Studio", "brooklyn@t.invalid");
  garage = await tw.signUp("Closed Garage", "garage@t.invalid");
  fresh = await tw.signUp("Brand New Shop", "fresh@t.invalid");

  for (const [k, t] of Object.entries({ alpine, brooklyn, garage, fresh })) {
    const you = (await tw.q<{ id: string }>("select id from staff_profiles where workspace_id = $1", [t.ws]))[0].id;
    await tw.q("update staff_profiles set active = false where id = $1", [you]); // only the staff created below is bookable
    biz[k] = { ws: t.ws, slug: t.slug, owner: t.userId, you };
  }
  // Different businesses: different services, staff, hours and time zones.
  staffId.alpine = await w.staff(biz.alpine, "Anna");
  svcId.alpine = await w.service(biz.alpine, "Haircut", 30, { staffIds: [staffId.alpine], price: 45 });
  staffId.brooklyn = await w.staff(biz.brooklyn, "Bob");
  svcId.brooklyn = await w.service(biz.brooklyn, "Deep tissue massage", 60, { staffIds: [staffId.brooklyn], price: 120 });
  await w.setHours(biz.brooklyn, null, { 1: [["10:00", "18:00"]], 2: [["10:00", "18:00"]], 3: [["10:00", "18:00"]], 4: [["10:00", "18:00"]], 5: [["10:00", "18:00"]] });
  staffId.garage = await w.staff(biz.garage, "Gina");
  svcId.garage = await w.service(biz.garage, "Oil change", 45, { staffIds: [staffId.garage], price: 80 });
  await setPublic(brooklyn, { publicBookingEnabled: true, discoverable: false }, { timezone: "America/New_York", currency: "USD" });
}, 180_000);
beforeEach(() => vi.setSystemTime(new Date(PINNED_NOW)));
afterAll(async () => {
  vi.useRealTimers();
  await db.close();
});

describe("a new business is not listed until it opts in", () => {
  it("defaults: bookable by link, absent from the directory; the directory is empty before anyone opts in", async () => {
    expect(await directory()).toEqual([]);
    for (const t of [alpine, brooklyn, garage, fresh]) {
      const r = (await tw.q<{ public_booking_enabled: boolean; discoverable: boolean }>("select public_booking_enabled, discoverable from workspaces where id = $1", [t.ws]))[0];
      expect(r).toEqual({ public_booking_enabled: true, discoverable: false });
    }
    expect((await loadPublicCatalog({ admin: tw.svc() }, fresh.slug))?.workspace.name).toBe("Brand New Shop");
  });
});

describe("the four combinations of 'online booking' x 'listed in the directory'", () => {
  it("enabled + discoverable: listed; enabled only: link works but NOT listed; disabled: neither", async () => {
    await setPublic(alpine, { publicBookingEnabled: true, discoverable: true });
    await setPublic(brooklyn, { publicBookingEnabled: true, discoverable: false });
    await setPublic(garage, { publicBookingEnabled: false, discoverable: false });

    expect(await directory()).toEqual([alpine.slug]);
    const admin = { admin: tw.svc() };
    expect((await loadPublicCatalog(admin, alpine.slug))?.workspace.slug).toBe(alpine.slug);
    expect((await loadPublicCatalog(admin, brooklyn.slug))?.workspace.slug).toBe(brooklyn.slug); // /book/<slug> still works
    expect(await loadPublicCatalog(admin, garage.slug)).toBeNull(); // switched off: looks like an unknown business
    expect(await loadPublicCatalog(admin, "no-such-business")).toBeNull();
  });

  it("a disabled business refuses slots and bookings and never appears, whatever the request says", async () => {
    const outcome = (p: Promise<unknown>) => p.then(() => "ok", (e: { code?: string }) => e.code ?? "error");
    expect(await outcome(getPublicSlots(w.deps(), { ip: "t" }, { slug: garage.slug, serviceId: svcId.garage, staffId: staffId.garage, date: D.mon }))).toBe("not_found");
    expect(await outcome(w.book(biz.garage, svcId.garage, staffId.garage, D.mon, "10:00"))).toBe("not_found");
    expect(await tw.q("select 1 from appointments where workspace_id = $1", [garage.ws])).toEqual([]);
    expect(await directory()).not.toContain(garage.slug);
  });

  it("the owner cannot list a business that is closed for booking: closing booking also withdraws the listing", async () => {
    await setPublic(alpine, { publicBookingEnabled: false, discoverable: true }); // inconsistent request
    expect(await directory()).toEqual([]);
    expect((await tw.q<{ discoverable: boolean }>("select discoverable from workspaces where id = $1", [alpine.ws]))[0].discoverable).toBe(false);
    // and the database itself refuses the inconsistent state, even for a direct write
    await expect(tw.q("update workspaces set discoverable = true, public_booking_enabled = false where id = $1", [alpine.ws])).rejects.toThrow();
    await setPublic(alpine, { publicBookingEnabled: true, discoverable: true });
    expect(await directory()).toEqual([alpine.slug]);
  });

  it("turning the directory on / off is reflected at once, per business", async () => {
    await setPublic(brooklyn, { publicBookingEnabled: true, discoverable: true });
    expect(await directory()).toEqual([alpine.slug, brooklyn.slug].sort());
    await setPublic(alpine, { publicBookingEnabled: true, discoverable: false });
    expect(await directory()).toEqual([brooklyn.slug]);
    await setPublic(alpine, { publicBookingEnabled: true, discoverable: true });
    await setPublic(brooklyn, { publicBookingEnabled: true, discoverable: false });
    expect(await directory()).toEqual([alpine.slug]);
  });

  it("the directory card has public fields only (no ids, contact data, industry, logo, time zone)", async () => {
    await setPublic(alpine, { publicBookingEnabled: true, discoverable: true }, { description: "Nice salon", city: "Berlin", country: "DE", phone: "+49 30 123", email: "hello@alpine.test", industry: "beauty" });
    const list = await listDiscoverableBusinesses({ admin: tw.svc() });
    expect(list).toEqual([{ slug: alpine.slug, name: "Alpine Salon", city: "Berlin", country: "DE", description: "Nice salon" }]);
    expect(Object.keys(list[0]).sort()).toEqual(["city", "country", "description", "name", "slug"]);
    expect(JSON.stringify(list)).not.toMatch(/@|\+49|beauty|logo|alpine\.test|[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it("demo presets can never be a real business: not creatable as a workspace, never in the directory", async () => {
    for (const d of demoWorkspaces) {
      await expect(tw.q("insert into workspaces (slug, name) values ($1, 'Fake demo')", [d.slug])).rejects.toThrow();
      expect(await directory()).not.toContain(d.slug);
      expect(await loadPublicCatalog({ admin: tw.svc() }, d.slug)).toBeNull();
    }
  });

  it("no business name or slug is special-cased in the code base (a 'Labrity'-like workspace is a normal one)", async () => {
    const t = await tw.signUp("Labrity", "labrity@t.invalid");
    expect(t.slug).toBe("labrity");
    expect(await directory()).not.toContain("labrity"); // not listed until it opts in, like everyone else
    await setPublic(t, { publicBookingEnabled: true, discoverable: true });
    expect(await directory()).toContain("labrity"); // and listed like everyone else once it does
    await setPublic(t, { publicBookingEnabled: true, discoverable: false });

    // static guard: the name appears only in the studio credit link / a doc comment, never next to slug logic
    const root = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          if (!["__tests__", "content", "node_modules"].includes(name) && !full.endsWith(path.join("lib", "i18n", "data"))) walk(full);
        } else if (/\.(ts|tsx)$/.test(name) && /labrity/i.test(readFileSync(full, "utf8"))) hits.push(path.relative(root, full));
      }
    };
    walk(root);
    expect(hits.sort()).toEqual(["components/layout/PublicFooter/PublicFooterView.tsx", "server/validation/businessProfile.schema.ts"]);
    for (const h of hits) {
      const lines = readFileSync(path.join(root, h), "utf8").split("\n").filter((l) => /labrity/i.test(l));
      expect(lines.some((l) => /slug|workspace/i.test(l) && !/^\s*(\/\*\*|\*|\/\/)/.test(l))).toBe(false);
    }
  });
});

describe("public booking in each business: only that business is offered and touched", () => {
  const dates = { alpine: D.mon, brooklyn: D.mon, garage: D.mon };
  let alpineGuestEmail: string;

  it("each public catalog lists only its own services / staff / hours / time zone", async () => {
    await setPublic(garage, { publicBookingEnabled: true, discoverable: false }); // garage opens its online booking
    const admin = { admin: tw.svc() };
    const cat = {
      alpine: (await loadPublicCatalog(admin, alpine.slug))!,
      brooklyn: (await loadPublicCatalog(admin, brooklyn.slug))!,
      garage: (await loadPublicCatalog(admin, garage.slug))!,
    };
    expect(cat.alpine.services.map((s) => s.name)).toEqual(["Haircut"]);
    expect(cat.brooklyn.services.map((s) => s.name)).toEqual(["Deep tissue massage"]);
    expect(cat.garage.services.map((s) => s.name)).toEqual(["Oil change"]);
    expect(cat.alpine.staff.map((s) => s.name)).toEqual(["Anna"]);
    expect(cat.brooklyn.staff.map((s) => s.name)).toEqual(["Bob"]);
    expect(cat.garage.staff.map((s) => s.name)).toEqual(["Gina"]);
    expect([cat.alpine, cat.brooklyn, cat.garage].map((c) => c.workspace.timezone)).toEqual(["Europe/Berlin", "America/New_York", "Europe/Berlin"]);
    const allIds = [cat.alpine, cat.brooklyn, cat.garage].flatMap((c) => [...c.services.map((s) => s.id), ...c.staff.map((s) => s.id)]);
    expect(new Set(allIds).size).toBe(allIds.length); // no id is shared between businesses
    // opening hours differ: Alpine 09:00, Brooklyn 10:00 (wall clock of their own zone)
    expect((await w.times(biz.alpine, svcId.alpine, staffId.alpine, dates.alpine))[0]).toBe("09:00");
    expect((await w.times(biz.brooklyn, svcId.brooklyn, staffId.brooklyn, dates.brooklyn))[0]).toBe("10:00");
    expect(JSON.stringify(cat)).not.toMatch(/@t\.invalid|owner|created_by/);
  });

  it("another business's service id or staff id inside a request is refused (slots and booking), and nothing is created", async () => {
    const pairs: [Biz, string, string | null][] = [
      [biz.alpine, svcId.brooklyn, staffId.alpine],
      [biz.alpine, svcId.alpine, staffId.brooklyn],
      [biz.alpine, svcId.garage, null],
      [biz.brooklyn, svcId.alpine, staffId.brooklyn],
      [biz.brooklyn, svcId.brooklyn, staffId.garage],
      [biz.garage, svcId.alpine, staffId.garage],
    ];
    for (const [b, service, staff] of pairs) {
      expect(await w.outcome(w.slots(b, service, staff, D.mon))).toBe("invalid_input");
      expect(await w.outcome(w.book(b, service, staff, D.mon, "10:00"))).toBe("invalid_input");
    }
    expect(await tw.q("select 1 from appointments where workspace_id in ($1,$2,$3)", [alpine.ws, brooklyn.ws, garage.ws])).toEqual([]);
  });

  it("a booking at each business is created ONLY in that business, in its own time zone", async () => {
    const guest = w.guest();
    alpineGuestEmail = guest.email;
    const a = await createPublicBooking(w.deps(), { ip: "198.51.100.7" }, { slug: alpine.slug, serviceId: svcId.alpine, staffId: staffId.alpine, date: D.mon, time: "10:00", client: guest });
    const b = await createPublicBooking(w.deps(), { ip: "198.51.100.8" }, { slug: brooklyn.slug, serviceId: svcId.brooklyn, staffId: staffId.brooklyn, date: D.mon, time: "11:00", client: guest }); // same person, other business
    const g = await createPublicBooking(w.deps(), { ip: "198.51.100.9" }, { slug: garage.slug, serviceId: svcId.garage, staffId: staffId.garage, date: D.tue, time: "09:00", client: w.guest() });

    const rows = await tw.q<{ id: string; workspace_id: string; starts_at: Date; timezone: string | null }>("select id, workspace_id, starts_at, timezone from appointments");
    expect(rows).toHaveLength(3);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[a.appointmentId].workspace_id).toBe(alpine.ws);
    expect(byId[b.appointmentId].workspace_id).toBe(brooklyn.ws);
    expect(byId[g.appointmentId].workspace_id).toBe(garage.ws);
    expect(byId[a.appointmentId].starts_at.toISOString()).toBe("2026-10-05T08:00:00.000Z"); // 10:00 Berlin (UTC+2)
    expect(byId[b.appointmentId].starts_at.toISOString()).toBe("2026-10-05T15:00:00.000Z"); // 11:00 New York (UTC-4)
    expect(byId[a.appointmentId].timezone).toBe("Europe/Berlin");
    expect(byId[b.appointmentId].timezone).toBe("America/New_York");
  });

  it("each business sees only its own booking in its calendar, clients and inbox; the same guest is a separate client per business", async () => {
    const expected: [Tenant, string, string][] = [[alpine, "Haircut", "Anna"], [brooklyn, "Deep tissue massage", "Bob"], [garage, "Oil change", "Gina"]];
    for (const [t, service, staff] of expected) {
      const s = await tw.session(t.userId, t.slug);
      const appts = await apptSvc.listAppointments(s);
      expect(appts).toHaveLength(1);
      expect(appts[0]).toMatchObject({ service, staff });
      const clients = await clientSvc.listClients(s);
      expect(clients).toHaveLength(1);
      expect(clients[0].name).toBe((appts[0] as { client: string }).client);
      const events = (await inboxSvc.listInboxEvents(s)).events;
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => /booking/i.test(e.type))).toBe(true);
      for (const other of expected.filter(([o]) => o !== t)) {
        const json = JSON.stringify([appts, clients, events]);
        expect(json).not.toContain(other[1]);
        expect(json).not.toContain(other[2]);
      }
    }
    // the guest who booked at Alpine AND Brooklyn exists as one ClientRecord in EACH business, never shared
    const same = await tw.q<{ workspace_id: string }>("select workspace_id from clients where email = $1", [alpineGuestEmail]);
    expect(same.map((r) => r.workspace_id).sort()).toEqual([alpine.ws, brooklyn.ws].sort());
  });
});
