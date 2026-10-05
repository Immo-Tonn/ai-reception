import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { createMemoryRateLimiter } from "@/server/ratelimit/memoryRateLimiter";
import { createPublicBooking } from "../publicBooking.service";
import {
  cancelMyBooking, claimBooking, getRescheduleSlots, issueBookingClaim, listMyBookings, rescheduleMyBooking, type ClientAccountDeps,
} from "@/server/clientAccount/clientAccount.service";
import { D, makeWorld, PINNED_NOW, type Biz, type World } from "./schedulingHarness";
import { makeTeamWorld, type TeamWorld, type Tenant } from "./teamStagingWorld";

/**
 * Team staging, part 4: ONE client account, MANY businesses. Guest bookings made at three real businesses in
 * three time zones (Berlin, New York, Tokyo) are claimed by the same account; "My bookings" shows all of
 * them, each with its own business name / slug / time zone / local wall clock, sorted by real time.
 */
vi.mock("@/lib/supabase/server", async () => ({ createSupabaseServerClient: async () => (await import("./teamStagingWorld")).holder.user }));
vi.mock("@/lib/supabase/admin", async () => ({ createSupabaseAdminClient: () => ({ rpc: async (n: string, a: Record<string, unknown>) => (await import("./teamStagingWorld")).holder.admin!.rpc(n, a) }) }));
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
const profileSvc = await import("@/server/services/businessProfile.service");
const apptSvc = await import("@/server/services/appointments.service");

let db: PGlite;
let tw: TeamWorld;
let w: World;
const T: Record<"berlin" | "newyork" | "tokyo", Tenant> = {} as never;
const B: Record<string, Biz> = {};
const svc: Record<string, string> = {};
const staff: Record<string, string> = {};
let C1: string;
let C2: string;
const ids: Record<string, string> = {};

const deps = (over: Partial<ClientAccountDeps> = {}): ClientAccountDeps => ({ admin: tw.svc(), rateLimiter: createMemoryRateLimiter(), ...over });
const q = <R = Record<string, unknown>>(sql: string, p: unknown[] = []) => tw.q<R>(sql, p);
const clientUser = async (label: string) => {
  const id = randomUUID();
  await db.query("insert into auth.users (id, email) values ($1,$2)", [id, `${label}@client.invalid`]); // a client account: NO profile, NO membership
  return id;
};
/** Guest booking at `key`, then claimed by `user` (the real flow: secret token issued at booking time). */
async function bookAndClaim(key: keyof typeof T, user: string, date: string, time: string) {
  const r = await createPublicBooking({ admin: tw.svc(), rateLimiter: createMemoryRateLimiter() }, { ip: "203.0.113.5" }, {
    slug: T[key].slug, serviceId: svc[key], staffId: staff[key], date, time, client: w.guest(),
  });
  const token = (await issueBookingClaim(deps(), r.appointmentId))!;
  await claimBooking(deps(), user, token);
  return { id: r.appointmentId, token };
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(PINNED_NOW));
  db = await createMigratedDb();
  tw = makeTeamWorld(db);
  w = makeWorld(db);
  const defs = [["berlin", "Berlin Salon", "Europe/Berlin", ["09:00", "18:00"]], ["newyork", "New York Spa", "America/New_York", ["10:00", "18:00"]], ["tokyo", "Tokyo Studio", "Asia/Tokyo", ["09:00", "17:00"]]] as const;
  for (const [key, name, tz, hours] of defs) {
    T[key] = await tw.signUp(name, `${key}@t.invalid`);
    const s = await tw.session(T[key].userId, T[key].slug);
    await profileSvc.updateBusinessProfile(s, { ...(await profileSvc.getBusinessProfile(s)), timezone: tz });
    const you = (await q<{ id: string }>("select id from staff_profiles where workspace_id = $1", [T[key].ws]))[0].id;
    await q("update staff_profiles set active = false where id = $1", [you]);
    B[key] = { ws: T[key].ws, slug: T[key].slug, owner: T[key].userId, you };
    staff[key] = await w.staff(B[key], `Pro ${key}`);
    svc[key] = await w.service(B[key], `Service ${key}`, 30, { staffIds: [staff[key]], price: 50 });
    const week = Object.fromEntries([1, 2, 3, 4, 5].map((d) => [d, [[hours[0], hours[1]]]])) as Record<number, [string, string][]>;
    await w.setHours(B[key], null, week);
  }
  C1 = await clientUser("c1");
  C2 = await clientUser("c2");
}, 180_000);
beforeEach(() => vi.setSystemTime(new Date(PINNED_NOW)));
afterAll(async () => {
  vi.useRealTimers();
  await db.close();
});

describe("one account claims bookings at three businesses", () => {
  it("guest bookings + claim: all of them are listed with the right business, slug, zone and LOCAL time", async () => {
    expect(await listMyBookings(deps(), C1)).toEqual([]);
    ids.berlinMon = (await bookAndClaim("berlin", C1, D.mon, "10:00")).id;
    ids.nyTue = (await bookAndClaim("newyork", C1, D.tue, "10:00")).id;
    ids.tokyoTue = (await bookAndClaim("tokyo", C1, D.tue, "15:00")).id;
    ids.berlinWed = (await bookAndClaim("berlin", C1, D.wed, "15:00")).id;
    ids.c2Berlin = (await bookAndClaim("berlin", C2, D.thu, "10:00")).id;

    const list = await listMyBookings(deps(), C1);
    const view = list.map((b) => ({ biz: b.businessName, slug: b.workspaceSlug, tz: b.timezone, date: b.date, time: b.time, end: b.endTime, iso: b.startsAt, service: b.serviceName }));
    expect(view).toEqual([
      { biz: "Berlin Salon", slug: T.berlin.slug, tz: "Europe/Berlin", date: D.mon, time: "10:00", end: "10:30", iso: "2026-10-05T08:00:00.000Z", service: "Service berlin" },
      // Tokyo 15:00 is EARLIER in real time than New York 10:00 on the same calendar day, although its wall clock is later
      { biz: "Tokyo Studio", slug: T.tokyo.slug, tz: "Asia/Tokyo", date: D.tue, time: "15:00", end: "15:30", iso: "2026-10-06T06:00:00.000Z", service: "Service tokyo" },
      { biz: "New York Spa", slug: T.newyork.slug, tz: "America/New_York", date: D.tue, time: "10:00", end: "10:30", iso: "2026-10-06T14:00:00.000Z", service: "Service newyork" },
      { biz: "Berlin Salon", slug: T.berlin.slug, tz: "Europe/Berlin", date: D.wed, time: "15:00", end: "15:30", iso: "2026-10-07T13:00:00.000Z", service: "Service berlin" },
    ]);
    expect(list.every((b) => b.isUpcoming && b.canCancel && b.canReschedule)).toBe(true);
  });

  it("the order is by real time, not by wall clock or business; past bookings go last (most recent first)", async () => {
    // Wed 00:00Z: everything has happened except Wed 15:00 Berlin (13:00Z)
    const now = () => new Date("2026-10-07T00:00:00Z");
    const list = await listMyBookings(deps({ now }), C1);
    expect(list.map((b) => b.id)).toEqual([ids.berlinWed, ids.nyTue, ids.tokyoTue, ids.berlinMon]);
    expect(list.map((b) => b.isUpcoming)).toEqual([true, false, false, false]);
    expect(list.slice(1).every((b) => !b.canCancel && !b.canReschedule)).toBe(true);
  });

  it("another client account sees none of it; it cannot cancel, move or even look up the first account's bookings", async () => {
    const c2 = await listMyBookings(deps(), C2);
    expect(c2.map((b) => b.id)).toEqual([ids.c2Berlin]);
    for (const id of [ids.berlinMon, ids.nyTue, ids.tokyoTue]) {
      await expect(cancelMyBooking(deps(), C2, id)).rejects.toMatchObject({ code: "not_found" });
      await expect(getRescheduleSlots(deps(), C2, id, D.wed)).rejects.toMatchObject({ code: "not_found" });
      await expect(rescheduleMyBooking(deps(), C2, id, D.wed, "10:00", null)).rejects.toMatchObject({ code: "not_found" });
    }
    const fresh = await clientUser("c3");
    expect(await listMyBookings(deps(), fresh)).toEqual([]);
    // the secret claim token of an already-claimed booking is no way in for somebody else
    const { token } = await bookAndClaim("berlin", C1, D.fri, "10:00");
    await expect(claimBooking(deps(), C2, token)).rejects.toMatchObject({ code: "not_manageable" });
    expect((await listMyBookings(deps(), C2)).map((b) => b.id)).toEqual([ids.c2Berlin]);
  });
});

describe("cancel and reschedule act in the booking's own business", () => {
  it("cancelling the New York booking touches only New York; the business sees it cancelled", async () => {
    await cancelMyBooking(deps(), C1, ids.nyTue);
    expect((await q<{ workspace_id: string; status: string }>("select workspace_id, status::text from appointments where id = $1", [ids.nyTue]))[0]).toEqual({ workspace_id: T.newyork.ws, status: "cancelled" });
    const others = await q<{ status: string }>("select status::text from appointments where id <> $1", [ids.nyTue]);
    expect(others.every((r) => r.status !== "cancelled")).toBe(true);
    const nySession = await tw.session(T.newyork.userId, T.newyork.slug);
    expect((await apptSvc.listAppointments(nySession))[0].status).toBe("cancelled");
    const mine = await listMyBookings(deps(), C1);
    expect(mine.find((b) => b.id === ids.nyTue)).toMatchObject({ status: "cancelled", canCancel: false, canReschedule: false });
    await expect(cancelMyBooking(deps(), C1, ids.nyTue)).rejects.toMatchObject({ code: "not_manageable" });
  });

  it("rescheduling the Tokyo booking offers only Tokyo's staff and hours and keeps it in Tokyo's zone", async () => {
    const slots = await getRescheduleSlots(deps(), C1, ids.tokyoTue, D.wed);
    expect(slots.length).toBeGreaterThan(0);
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set([staff.tokyo]));
    expect(slots[0].time).toBe("09:00");
    expect(slots.every((s) => s.time >= "09:00" && s.time < "17:00")).toBe(true);
    await rescheduleMyBooking(deps(), C1, ids.tokyoTue, D.wed, "13:30", staff.tokyo);
    const moved = (await listMyBookings(deps(), C1)).find((b) => b.id === ids.tokyoTue)!;
    expect(moved).toMatchObject({ workspaceSlug: T.tokyo.slug, timezone: "Asia/Tokyo", date: D.wed, time: "13:30" });
    expect(moved.startsAt).toBe("2026-10-07T04:30:00.000Z");
    // moving into another business's staff is not possible: a Berlin staff id is just "no slot"
    await expect(rescheduleMyBooking(deps(), C1, ids.tokyoTue, D.thu, "10:00", staff.berlin)).rejects.toMatchObject({ code: "invalid_input" });
    expect((await q<{ workspace_id: string; staff_id: string }>("select workspace_id, staff_id from appointments where id = $1", [ids.tokyoTue]))[0]).toEqual({ workspace_id: T.tokyo.ws, staff_id: staff.tokyo });
  });
});

describe("the client cannot reach internal business data", () => {
  it("a client account has no direct access to any business table", async () => {
    const c = createPgliteSupabaseClient(db, { kind: "user", id: C1 });
    for (const t of await tw.tenantTables()) {
      const r = await c.from(t).select("*");
      expect(((r.data as unknown[] | null) ?? []).length, `client reads ${t}`).toBe(0);
    }
    for (const t of ["workspaces", "workspace_members", "profiles", "booking_claims", "client_accounts"]) {
      const rows = ((await c.from(t).select("*")).data as Record<string, unknown>[] | null) ?? [];
      expect(rows.filter((r) => r.user_id !== C1 && r.id !== C1), `client reads ${t}`).toEqual([]);
    }
    expect((await c.rpc("analytics_overview", { p_workspace_id: T.berlin.ws, p_from: "2026-10-01", p_to: "2026-10-31" })).error).not.toBeNull();
    expect((await c.rpc("list_my_bookings", { p_user_id: C1, p_limit: 5 })).error).not.toBeNull(); // service-role only, takes the id from the SERVER session
    expect((await c.from("appointments").update({ status: "cancelled" }).eq("id", ids.berlinWed).select("id")).data ?? []).toEqual([]);
    expect((await q<{ status: string }>("select status::text from appointments where id = $1", [ids.berlinWed]))[0].status).not.toBe("cancelled");
  });

  it("the list contains only customer-safe keys, and never a private / owner-only appointment", async () => {
    const safe = ["businessName", "canCancel", "canReschedule", "currency", "date", "endTime", "endsAt", "id", "isUpcoming", "price", "resourceId", "serviceId", "serviceName", "staffId", "staffName", "startsAt", "status", "time", "timezone", "workspaceSlug"];
    const list = await listMyBookings(deps(), C1);
    for (const b of list) expect(Object.keys(b).sort()).toEqual(safe);
    expect(JSON.stringify(list)).not.toMatch(/notes|financial|bucket|visibility|workspace_id|client_id|created_by|@/i);
    await q("update appointments set visibility = 'private' where id = $1", [ids.berlinWed]);
    expect((await listMyBookings(deps(), C1)).map((b) => b.id)).not.toContain(ids.berlinWed);
    await q("update appointments set visibility = 'normal' where id = $1", [ids.berlinWed]);
    expect((await listMyBookings(deps(), C1)).map((b) => b.id)).toContain(ids.berlinWed);
  });
});
