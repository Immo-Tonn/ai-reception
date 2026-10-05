import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { createSupabaseAppointmentsRepository } from "@/server/repository/appointmentsSupabaseRepository";
import { createSupabaseClientsRepository } from "@/server/repository/clientsSupabaseRepository";
import { createMemoryRateLimiter } from "@/server/ratelimit/memoryRateLimiter";
import { wallToInstant } from "@/lib/time/zonedTime";
import {
  cancelMyBooking,
  claimBooking,
  getRescheduleSlots,
  issueBookingClaim,
  listMyBookings,
  rescheduleMyBooking,
  type ClientAccountDeps,
} from "@/server/clientAccount/clientAccount.service";
import { D, makeWorld, PINNED_NOW, type Biz, type World } from "./schedulingHarness";

let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const staffSvc = await import("@/server/services/staffAdmin.service");
const resSvc = await import("@/server/services/resourcesAdmin.service");
const hoursSvc = await import("@/server/services/workingHours.service");
const rulesSvc = await import("@/server/services/bookingRules.service");
const { PermissionDeniedError } = await import("@/server/permissions/roles");
const { RepositoryNotFoundError } = await import("@/server/repository/errors");

/**
 * Agent D - SECURITY and REGRESSION tests for the staff-scheduling stage, against real SQL (PGlite, every
 * migration, RLS on, the Supabase shim) and the real services. Tenant isolation is checked three ways:
 * through the services, through forged sessions (the app guard is bypassed: RLS must still hold) and with
 * direct user-scoped queries.
 */
let db: PGlite;
let w: World;
let A: Biz;
let B: Biz;
let admin: string;
let manager: string;
let staffRole: string;
let accountant: string;
let outsider: string; // signed in, member of no business
let annaA: string;
let svcA: string;
let roomA: string;
let timeOffA: string;
let closureA: string;
let apptA: string;

const setNow = (iso: string) => vi.setSystemTime(new Date(iso));
const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const sessionOf = async (user: string, biz: Biz) => (as(user), getSession(biz.slug));
const week = { 1: [{ start: "09:00", end: "12:00" }] } as never;
const rulesInput = (over: Record<string, unknown> = {}) =>
  ({ autoConfirm: false, minNoticeMinutes: 0, maxHorizonDays: 90, slotIntervalMinutes: 15, cancellationDeadlineHours: 0, rescheduleDeadlineHours: 0, ...over }) as never;

/** Everything that belongs to workspace A (scheduling data), as one comparable value. */
async function snapshotA() {
  const out: Record<string, unknown> = {};
  out.staff = await w.q("select id, name, title, active, schedule_mode, sort_order from staff_profiles where workspace_id = $1 order by id", [A.ws]);
  out.resources = await w.q("select id, name, type::text, active, description from resources where workspace_id = $1 order by id", [A.ws]);
  out.hours = await w.q("select id, staff_id, weekday, start_time, end_time, is_day_off from working_hours where workspace_id = $1 order by id", [A.ws]);
  out.timeOff = await w.q("select id, staff_id, start_date, end_date, start_time, end_time, reason from time_off where workspace_id = $1 order by id", [A.ws]);
  out.links = await w.q("select sr.service_id, sr.resource_id from service_resources sr join services s on s.id = sr.service_id where s.workspace_id = $1 order by 1, 2", [A.ws]);
  out.staffLinks = await w.q("select l.service_id, l.staff_id from service_staff l join services s on s.id = l.service_id where s.workspace_id = $1 order by 1, 2", [A.ws]);
  out.rules = await w.q("select auto_confirm_bookings, min_notice_minutes, max_horizon_days, slot_interval_minutes, cancellation_deadline_hours, reschedule_deadline_hours, name from workspaces where id = $1", [A.ws]);
  out.services = await w.q("select id, name, active from services where workspace_id = $1 order by id", [A.ws]);
  return JSON.stringify(out);
}

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setNow(PINNED_NOW);
  db = await createMigratedDb();
  w = makeWorld(db);

  A = await w.biz("sec-a");
  B = await w.biz("sec-b");
  admin = await w.member(A, "admin");
  manager = await w.member(A, "manager");
  staffRole = await w.member(A, "staff");
  accountant = await w.member(A, "accountant");
  outsider = await w.user("outsider");

  annaA = await w.staff(A, "Anna", { mode: "custom", hours: { 1: [["09:00", "12:00"]] }, title: "Colour specialist" });
  svcA = await w.service(A, "Treatment", 60, { resType: "room", staffIds: [annaA] });
  roomA = await w.resource(A, "Room 1", "room", { serviceIds: [svcA] });
  timeOffA = await w.timeOff(A, annaA, D.thu, D.thu, undefined, "Surgery on Thursday");
  closureA = await w.timeOff(A, null, D.fri, D.fri, undefined, "Secret company retreat");
  await w.rules(A, { minNoticeMinutes: 45, maxHorizonDays: 60, slotIntervalMinutes: 30, cancellationDeadlineHours: 12, rescheduleDeadlineHours: 6 });
  const client = (await w.q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Walk-in','walkin@example.test') returning id", [A.ws]))[0].id;
  apptA = (
    await w.q<{ id: string }>(
      "insert into appointments (workspace_id, client_id, service_id, staff_id, resource_id, starts_at, ends_at) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [A.ws, client, svcA, annaA, roomA, wallToInstant(D.mon, "10:00", "Europe/Berlin"), wallToInstant(D.mon, "11:00", "Europe/Berlin")],
    )
  )[0].id;
  // B has data of its own
  await w.staff(B, "Bea");
}, 120_000);
beforeEach(() => setNow(PINNED_NOW));
afterAll(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("(4) tenant isolation through the services", () => {
  it("Workspace B's owner cannot read, change or link anything of A (staff, resources, hours, time off, rules)", async () => {
    const before = await snapshotA();
    const b = await sessionOf(B.owner, B);

    expect((await staffSvc.listStaffAdmin(b)).map((s) => s.id)).not.toContain(annaA);
    expect((await resSvc.listResourcesAdmin(b)).map((r) => r.id)).not.toContain(roomA);
    const hours = await hoursSvc.getWorkingHours(b);
    expect(Object.keys(hours.staff)).not.toContain(annaA);
    expect((await hoursSvc.listTimeOff(b)).map((t) => t.id)).not.toContain(timeOffA);
    expect((await hoursSvc.listTimeOff(b)).map((t) => t.id)).not.toContain(closureA);
    expect((await rulesSvc.getBookingRules(b)).businessName).toBe((await w.q<{ name: string }>("select name from workspaces where id = $1", [B.ws]))[0].name);

    await expect(staffSvc.updateStaff(b, annaA, { name: "Hacked" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(staffSvc.setStaffActive(b, annaA, false)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(staffSvc.setStaffSchedule(b, annaA, { mode: "custom", weekly: week })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(staffSvc.setStaffSchedule(b, annaA, { mode: "inherit" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(resSvc.updateResource(b, roomA, { name: "Hacked" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(resSvc.setResourceActive(b, roomA, false)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(hoursSvc.replaceStaffWorkingHours(b, annaA, week)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(hoursSvc.createTimeOff(b, { staffId: annaA, startDate: D.tue, endDate: D.tue } as never)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(hoursSvc.deleteTimeOff(b, timeOffA)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(hoursSvc.deleteTimeOff(b, closureA)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    // linking A's services to B's people / resources
    await expect(staffSvc.createStaff(b, { name: "Spy", serviceIds: [svcA] })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(resSvc.createResource(b, { name: "Spy room", type: "room", serviceIds: [svcA] })).rejects.toBeInstanceOf(RepositoryNotFoundError);

    // B's own booking-rules save only ever touches B
    await rulesSvc.updateBookingRules(b, rulesInput({ minNoticeMinutes: 999 }));
    expect(await snapshotA()).toBe(before);
    expect((await w.q<{ n: number }>("select min_notice_minutes n from workspaces where id = $1", [B.ws]))[0].n).toBe(999);
    await w.rules(B, { minNoticeMinutes: 0 });
  });

  it("FORGED session (B's user claiming A's workspace id and the owner role): the app guard is bypassed, RLS still holds", async () => {
    const before = await snapshotA();
    as(B.owner);
    const forged = { userId: B.owner, workspaceId: A.ws, role: "owner" as const };

    // reads: nothing of A is visible
    expect(await staffSvc.listStaffAdmin(forged)).toEqual([]);
    expect(await resSvc.listResourcesAdmin(forged)).toEqual([]);
    expect(await hoursSvc.listTimeOff(forged)).toEqual([]);
    const hours = await hoursSvc.getWorkingHours(forged);
    expect(hours.staff).toEqual({});
    expect(Object.values(hours.business).flat()).toEqual([]);
    await expect(rulesSvc.getBookingRules(forged)).rejects.toThrow();

    // writes: every one is refused or finds no row
    await expect(staffSvc.createStaff(forged, { name: "Forged" })).rejects.toThrow();
    await expect(staffSvc.updateStaff(forged, annaA, { name: "Forged" })).rejects.toThrow();
    await expect(staffSvc.setStaffActive(forged, annaA, false)).rejects.toThrow();
    await expect(staffSvc.setStaffSchedule(forged, annaA, { mode: "inherit" })).rejects.toThrow();
    await expect(resSvc.createResource(forged, { name: "Forged", type: "room" })).rejects.toThrow();
    await expect(resSvc.setResourceActive(forged, roomA, false)).rejects.toThrow();
    await expect(hoursSvc.replaceBusinessWorkingHours(forged, week)).rejects.toThrow();
    await expect(hoursSvc.replaceStaffWorkingHours(forged, annaA, week)).rejects.toThrow();
    await expect(hoursSvc.createTimeOff(forged, { staffId: null, startDate: D.tue, endDate: D.tue } as never)).rejects.toThrow();
    await expect(hoursSvc.deleteTimeOff(forged, timeOffA)).rejects.toThrow();
    await expect(rulesSvc.updateBookingRules(forged, rulesInput({ autoConfirm: true, minNoticeMinutes: 1 }))).rejects.toThrow();
    expect(await snapshotA()).toBe(before);
  });
});

describe("(4) tenant isolation with direct user-scoped queries", () => {
  const tables = ["staff_profiles", "resources", "working_hours", "time_off"] as const;

  it.each([["workspace B's owner", () => B.owner], ["a signed-in user without any business", () => outsider]])(
    "%s: cannot read, insert, update or delete A's rows",
    async (_label, who) => {
      const before = await snapshotA();
      const client = createPgliteSupabaseClient(db, { kind: "user", id: who() });
      for (const t of tables) {
        expect((await client.from(t).select("*").eq("workspace_id", A.ws)).data, `${t} read`).toEqual([]);
        expect((await client.from(t).select("*")).data?.every((r) => (r as { workspace_id: string }).workspace_id !== A.ws), `${t} read all`).toBe(true);
      }
      expect((await client.from("service_resources").select("*").eq("service_id", svcA)).data).toEqual([]);
      expect((await client.from("service_staff").select("*").eq("service_id", svcA)).data).toEqual([]);
      expect((await client.from("workspaces").select("*").eq("id", A.ws)).data).toEqual([]);

      // inserts into A
      expect((await client.from("staff_profiles").insert({ workspace_id: A.ws, name: "X" })).error).toBeTruthy();
      expect((await client.from("resources").insert({ workspace_id: A.ws, name: "X", type: "room" })).error).toBeTruthy();
      expect((await client.from("working_hours").insert({ workspace_id: A.ws, staff_id: null, weekday: 6, start_time: "09:00", end_time: "10:00", is_day_off: false })).error).toBeTruthy();
      expect((await client.from("time_off").insert({ workspace_id: A.ws, staff_id: null, start_date: D.tue, end_date: D.tue })).error).toBeTruthy();
      expect((await client.from("service_resources").insert({ service_id: svcA, resource_id: roomA })).error).toBeTruthy();

      // updates / deletes silently match no row
      expect((await client.from("staff_profiles").update({ name: "Hacked", active: false }).eq("id", annaA).select("id")).data).toEqual([]);
      expect((await client.from("resources").update({ name: "Hacked", active: false }).eq("id", roomA).select("id")).data).toEqual([]);
      expect((await client.from("time_off").update({ end_date: D.sun }).eq("id", timeOffA).select("id")).data).toEqual([]);
      expect((await client.from("working_hours").update({ is_day_off: true }).eq("workspace_id", A.ws).select("id")).data).toEqual([]);
      expect((await client.from("workspaces").update({ auto_confirm_bookings: true, min_notice_minutes: 1, max_horizon_days: 1 }).eq("id", A.ws).select("id")).data).toEqual([]);
      for (const t of ["time_off", "working_hours", "resources", "staff_profiles"] as const) await client.from(t).delete().eq("workspace_id", A.ws);
      await client.from("service_resources").delete().eq("service_id", svcA);
      expect(await snapshotA()).toBe(before);
    },
  );

  it("cross-workspace references are refused by the database even for B's OWN permitted writes", async () => {
    const client = createPgliteSupabaseClient(db, { kind: "user", id: B.owner });
    const roomB = await w.resource(B, "Room B", "room");
    const svcB = await w.service(B, "Svc B", 30);
    // time off in B pointing at A's staff member
    const t = await client.from("time_off").insert({ workspace_id: B.ws, staff_id: annaA, start_date: D.tue, end_date: D.tue });
    expect(t.error?.message).toMatch(/cross_workspace_reference/);
    // B's service linked to a resource of A
    const l1 = await client.from("service_resources").insert({ service_id: svcB, resource_id: roomA });
    expect(l1.error).toBeTruthy();
    // A's service linked to B's resource (service in A: denied by RLS)
    const l2 = await client.from("service_resources").insert({ service_id: svcA, resource_id: roomB });
    expect(l2.error).toBeTruthy();
    // an appointment of B pointing at A's resource / staff
    const clientB = (await w.q<{ id: string }>("insert into clients (workspace_id,name) values ($1,'cb') returning id", [B.ws]))[0].id;
    for (const [staff, res] of [[annaA, null], [(await w.q<{ id: string }>("select id from staff_profiles where workspace_id = $1 limit 1", [B.ws]))[0].id, roomA]] as const) {
      const r = await client.from("appointments").insert({
        workspace_id: B.ws, client_id: clientB, service_id: svcB, staff_id: staff, resource_id: res,
        starts_at: wallToInstant(D.tue, "10:00", "Europe/Berlin").toISOString(), ends_at: wallToInstant(D.tue, "10:30", "Europe/Berlin").toISOString(), created_by: B.owner,
      });
      expect(r.error, JSON.stringify([staff, res])).toBeTruthy();
    }
    expect(await w.q("select 1 from working_hours where workspace_id = $1 and staff_id = $2", [B.ws, annaA])).toHaveLength(0);
  });

  it("working_hours of B cannot be attached to A's staff member (staff_id from another workspace)", async () => {
    const client = createPgliteSupabaseClient(db, { kind: "user", id: B.owner });
    const r = await client.from("working_hours").insert({ workspace_id: B.ws, staff_id: annaA, weekday: 6, start_time: "09:00", end_time: "10:00", is_day_off: false });
    expect(r.error, "a foreign staff_id must be refused").toBeTruthy();
    expect(await w.q("select 1 from working_hours where staff_id = $1 and workspace_id = $2", [annaA, B.ws])).toHaveLength(0);
  });
});

describe("(4) anonymous visitors", () => {
  it("anon cannot read, write or enumerate any internal scheduling table", async () => {
    const anon = w.anon();
    for (const t of ["staff_profiles", "resources", "working_hours", "time_off", "service_resources", "service_staff", "workspaces", "appointments"]) {
      expect((await anon.from(t).select("*")).data ?? [], t).toEqual([]);
    }
    for (const [t, row] of [
      ["time_off", { workspace_id: A.ws, start_date: D.tue, end_date: D.tue }],
      ["staff_profiles", { workspace_id: A.ws, name: "x" }],
      ["resources", { workspace_id: A.ws, name: "x", type: "room" }],
      ["working_hours", { workspace_id: A.ws, weekday: 1, is_day_off: true }],
      ["service_resources", { service_id: svcA, resource_id: roomA }],
    ] as const) {
      expect((await anon.from(t).insert(row as never)).error, `${t} insert`).toBeTruthy();
    }
    expect((await anon.from("workspaces").update({ min_notice_minutes: 0 }).eq("id", A.ws).select("id")).data ?? []).toEqual([]);
  });

  it("the guest-facing functions are service-role only (anon and signed-in users get permission denied)", async () => {
    for (const client of [w.anon(), createPgliteSupabaseClient(db, { kind: "user", id: B.owner })]) {
      expect((await client.rpc("get_public_booking_catalog", { p_slug: A.slug })).error?.code).toBe("42501");
      expect((await client.rpc("cancel_my_booking", { p_user_id: outsider, p_appointment_id: apptA })).error?.code).toBe("42501");
      expect((await client.rpc("reschedule_my_booking", { p_user_id: outsider, p_appointment_id: apptA, p_new_starts_at: "2026-10-12T08:00:00Z", p_staff_id: annaA, p_resource_id: roomA })).error?.code).toBe("42501");
      expect((await client.rpc("create_public_booking", { p_workspace_id: A.ws, p_service_id: svcA, p_staff_id: annaA, p_resource_id: roomA, p_starts_at: "2026-10-12T08:00:00Z", p_name: "x", p_email: "x@example.test", p_phone: "", p_notes: "" })).error?.code).toBe("42501");
    }
  });

  it("the public catalog carries no reasons and no internal fields; only whitelisted keys per entity", async () => {
    await w.staff(A, "Retired", { active: false });
    await w.resource(A, "Old room", "room", { active: false });
    await w.timeOff(A, null, "2026-09-01", "2026-09-02", undefined, "Old closure reason"); // long past
    const { data, error } = await w.admin().rpc("get_public_booking_catalog", { p_slug: A.slug });
    expect(error).toBeNull();
    const catalog = data as Record<string, unknown> & {
      staff: Record<string, unknown>[]; resources: Record<string, unknown>[]; timeOff: Record<string, unknown>[];
      workingHours: Record<string, unknown>[]; services: Record<string, unknown>[]; rules: Record<string, unknown>; staffModes: Record<string, unknown>[];
    };
    const text = JSON.stringify(catalog);
    for (const secret of ["Surgery on Thursday", "Secret company retreat", "Old closure reason", "reason", "created_by", "profile_id", "workspace_id", "Retired", "Old room", "walkin@example.test"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(catalog.staff.map((s) => Object.keys(s).sort())).toEqual(catalog.staff.map(() => ["id", "name", "title"]));
    expect(catalog.resources.map((r) => Object.keys(r).sort())).toEqual(catalog.resources.map(() => ["id", "name", "type"]));
    expect(catalog.staffModes.map((r) => Object.keys(r).sort())).toEqual(catalog.staffModes.map(() => ["mode", "staffId"]));
    for (const t of catalog.timeOff) expect(Object.keys(t).sort()).toEqual(["endDate", "endTime", "staffId", "startDate", "startTime"]);
    for (const h of catalog.workingHours) expect(Object.keys(h).sort()).toEqual(["end", "isDayOff", "staffId", "start", "weekday"]);
    expect(Object.keys(catalog.rules).sort()).toEqual(["autoConfirm", "maxHorizonDays", "minNoticeMinutes", "slotIntervalMinutes"]); // no deadlines, no internals
    expect(catalog.timeOff.some((t) => t.staffId === null && t.startDate === D.fri)).toBe(true); // the closure itself IS public (needed to hide the day)
    expect(catalog.timeOff.some((t) => t.startDate === "2026-09-01")).toBe(false); // history is not shipped
    expect((catalog.services as { price: unknown }[]).length).toBeGreaterThan(0);
    expect(new Set(Object.keys(catalog))).toEqual(new Set(["workspace", "profile", "rules", "services", "staff", "staffModes", "resources", "workingHours", "timeOff"]));
  });

  it("the catalog of one business never contains another's staff, resources or time off", async () => {
    const { data } = await w.admin().rpc("get_public_booking_catalog", { p_slug: B.slug });
    const text = JSON.stringify(data);
    for (const id of [annaA, roomA, timeOffA, closureA, svcA]) expect(text).not.toContain(id);
  });
});

describe("(4) roles: who may write schedules", () => {
  it("staff, manager and accountant are refused by the services (default deny); read gates too", async () => {
    const before = await snapshotA();
    for (const user of [staffRole, manager, accountant]) {
      const s = await sessionOf(user, A);
      await expect(staffSvc.createStaff(s, { name: "No" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(staffSvc.setStaffActive(s, annaA, false)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(staffSvc.setStaffSchedule(s, annaA, { mode: "inherit" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(resSvc.createResource(s, { name: "No", type: "room" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(hoursSvc.replaceBusinessWorkingHours(s, week)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(hoursSvc.replaceStaffWorkingHours(s, annaA, week)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(hoursSvc.createTimeOff(s, { staffId: null, startDate: D.tue, endDate: D.tue } as never)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(hoursSvc.deleteTimeOff(s, timeOffA)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(rulesSvc.updateBookingRules(s, rulesInput({ autoConfirm: true }))).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(hoursSvc.listTimeOff(s)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(rulesSvc.getBookingRules(s)).rejects.toBeInstanceOf(PermissionDeniedError);
    }
    expect(await snapshotA()).toBe(before);
  });

  it("the same roles are stopped by Row Level Security even with direct queries (UI/service bypassed)", async () => {
    const before = await snapshotA();
    for (const user of [staffRole, manager, accountant]) {
      const c = createPgliteSupabaseClient(db, { kind: "user", id: user });
      expect((await c.from("working_hours").insert({ workspace_id: A.ws, staff_id: null, weekday: 6, start_time: "09:00", end_time: "10:00", is_day_off: false })).error).toBeTruthy();
      expect((await c.from("time_off").insert({ workspace_id: A.ws, staff_id: null, start_date: D.tue, end_date: D.tue })).error).toBeTruthy();
      expect((await c.from("staff_profiles").insert({ workspace_id: A.ws, name: "No" })).error).toBeTruthy();
      expect((await c.from("resources").insert({ workspace_id: A.ws, name: "No", type: "room" })).error).toBeTruthy();
      expect((await c.from("service_resources").insert({ service_id: svcA, resource_id: roomA })).error).toBeTruthy();
      expect((await c.from("time_off").update({ end_date: D.sun }).eq("id", timeOffA).select("id")).data).toEqual([]);
      expect((await c.from("working_hours").update({ is_day_off: true }).eq("workspace_id", A.ws).select("id")).data).toEqual([]);
      expect((await c.from("staff_profiles").update({ active: false }).eq("id", annaA).select("id")).data).toEqual([]);
      expect((await c.from("resources").update({ active: false }).eq("id", roomA).select("id")).data).toEqual([]);
      expect((await c.from("workspaces").update({ min_notice_minutes: 0, auto_confirm_bookings: true }).eq("id", A.ws).select("id")).data).toEqual([]);
      await c.from("time_off").delete().eq("id", timeOffA);
      await c.from("working_hours").delete().eq("workspace_id", A.ws);
    }
    expect(await snapshotA()).toBe(before);
  });

  it("an admin (staff.manage + settings.manage) may manage; and the change is audited without the private reason", async () => {
    const s = await sessionOf(admin, A);
    const t = await hoursSvc.createTimeOff(s, { staffId: annaA, startDate: D.tue, endDate: D.tue, reason: "Visa appointment (private)" } as never);
    expect(t.reason).toBe("Visa appointment (private)");
    const log = JSON.stringify(await w.q("select summary from audit_logs where workspace_id = $1", [A.ws]));
    expect(log).not.toContain("Visa appointment");
    await hoursSvc.deleteTimeOff(s, t.id);
  });

  it("members can READ time off (design: members read) - but the guest catalog and the owner-only audit never expose the reason", async () => {
    const c = createPgliteSupabaseClient(db, { kind: "user", id: staffRole });
    const rows = (await c.from("time_off").select("*").eq("workspace_id", A.ws)).data as { reason: string }[];
    expect(rows.length).toBeGreaterThan(0);
    // The reason column is readable by any member (RLS is row-level). If this is ever tightened (view / column grant),
    // change this expectation: the contract in docs/STAFF_SCHEDULING.md only says "members read".
    expect(rows.some((r) => r.reason.length > 0)).toBe(true);
  });
});

describe("(4) replace_working_hours (0020, SECURITY INVOKER): RLS and the integrity trigger still apply", () => {
  const call = (client: SupabaseClient, ws: string, staff: string | null, rows: unknown[]) =>
    client.rpc("replace_working_hours", { p_workspace_id: ws, p_staff_id: staff, p_rows: JSON.stringify(rows) });
  const day = (weekday: number, start: string, end: string) => ({ weekday, start_time: start, end_time: end, is_day_off: false });

  it("another business's owner and a staff-role member cannot replace A's hours (nothing is deleted, nothing inserted)", async () => {
    const before = await snapshotA();
    for (const who of [B.owner, staffRole, manager, outsider]) {
      const c = createPgliteSupabaseClient(db, { kind: "user", id: who });
      expect((await call(c, A.ws, null, [day(1, "00:00", "23:00")])).error, who).toBeTruthy();
      expect((await call(c, A.ws, annaA, [day(2, "00:00", "23:00")])).error, who).toBeTruthy();
    }
    expect(await snapshotA()).toBe(before);
  });

  it("the owner's call is atomic: an overlapping week is rejected and the previous week stays untouched; a valid week replaces it", async () => {
    const T = await w.biz("atomic");
    await w.setHours(T, null, { 1: [["09:00", "12:00"]] });
    const read = async () => JSON.stringify(await w.q("select weekday, start_time, end_time, is_day_off from working_hours where workspace_id = $1 and staff_id is null order by weekday, start_time", [T.ws]));
    const before = await read();
    const owner = createPgliteSupabaseClient(db, { kind: "user", id: T.owner });
    const bad = await call(owner, T.ws, null, [day(3, "09:00", "12:00"), day(3, "11:00", "13:00")]);
    expect(bad.error?.message).toMatch(/working_hours_overlap/);
    expect(await read()).toBe(before);
    const good = await call(owner, T.ws, null, [day(3, "10:00", "12:00"), { weekday: 1, is_day_off: true }]);
    expect(good.error).toBeNull();
    expect(JSON.parse(await read())).toEqual([
      { weekday: 1, start_time: null, end_time: null, is_day_off: true },
      { weekday: 3, start_time: "10:00:00", end_time: "12:00:00", is_day_off: false },
    ]);
    // a staff id of another business is refused (same-workspace guard)
    expect((await call(owner, T.ws, annaA, [day(1, "09:00", "10:00")])).error).toBeTruthy();
  });
});

describe("(4) history is preserved: restrict-delete", () => {
  it("staff, resource and service referenced by an appointment cannot be hard-deleted - not by the owner, not by the service role", async () => {
    for (const actor of [createPgliteSupabaseClient(db, { kind: "user", id: A.owner }), w.admin()]) {
      for (const [table, id] of [["staff_profiles", annaA], ["resources", roomA], ["services", svcA]] as const) {
        const r = await actor.from(table).delete().eq("id", id);
        expect(r.error?.code, table).toBe("23503");
      }
    }
    expect(await w.q("select 1 from appointments where id = $1 and staff_id = $2 and resource_id = $3 and service_id = $4", [apptA, annaA, roomA, svcA])).toHaveLength(1);
  });

  it("cancelled appointments still protect their staff; unused rows can be deleted; deactivated ones stay readable by name", async () => {
    const spare = await w.staff(A, "Spare");
    const used = await w.staff(A, "Used");
    const svc = await w.service(A, "Used svc", 30);
    const client = (await w.q<{ id: string }>("select id from clients where workspace_id = $1 limit 1", [A.ws]))[0].id;
    await w.q("insert into appointments (workspace_id, client_id, service_id, staff_id, starts_at, ends_at, status) values ($1,$2,$3,$4,$5,$6,'cancelled')", [A.ws, client, svc, used, wallToInstant(D.tue, "10:00", "Europe/Berlin"), wallToInstant(D.tue, "10:30", "Europe/Berlin")]);
    const owner = createPgliteSupabaseClient(db, { kind: "user", id: A.owner });
    expect((await owner.from("staff_profiles").delete().eq("id", used)).error?.code).toBe("23503");
    expect((await owner.from("staff_profiles").delete().eq("id", spare)).error).toBeNull();
    // archive instead: old appointments keep the name
    await w.q("update staff_profiles set active = false where id = $1", [used]);
    const repo = createSupabaseAppointmentsRepository(A.ws, async () => createPgliteSupabaseClient(db, { kind: "user", id: A.owner }));
    expect((await repo.list()).find((a) => a.staffId === used)?.staff).toBe("Used");
  });

  it("deleting a whole workspace still cascades (the guard only protects live workspaces)", async () => {
    const T = await w.biz("temp");
    const st = await w.staff(T, "Temp staff");
    const sv = await w.service(T, "Temp svc", 30);
    const cl = (await w.q<{ id: string }>("insert into clients (workspace_id,name) values ($1,'c') returning id", [T.ws]))[0].id;
    await w.q("insert into appointments (workspace_id, client_id, service_id, staff_id, starts_at, ends_at) values ($1,$2,$3,$4,$5,$6)", [T.ws, cl, sv, st, wallToInstant(D.tue, "10:00", "Europe/Berlin"), wallToInstant(D.tue, "10:30", "Europe/Berlin")]);
    expect((await w.admin().from("workspaces").delete().eq("id", T.ws)).error).toBeNull();
    expect(await w.q("select 1 from staff_profiles where workspace_id = $1", [T.ws])).toHaveLength(0);
  });
});

describe("(4) cancel / reschedule rules through the client-account service", () => {
  let c1: string;
  let c2: string;
  let biz: Biz;
  let anna: string;
  let svc: string;
  const cdeps = (over: Partial<ClientAccountDeps> = {}): ClientAccountDeps => ({ admin: w.admin(), rateLimiter: createMemoryRateLimiter(), ...over });

  async function claimed(date: string, time: string, user = c1) {
    const r = await w.book(biz, svc, anna, date, time);
    const token = (await issueBookingClaim(cdeps(), r.appointmentId))!;
    await claimBooking(cdeps(), user, token);
    return r.appointmentId;
  }
  const status = async (id: string) => (await w.row(id)).status;

  beforeAll(async () => {
    c1 = await w.user("client1");
    c2 = await w.user("client2");
    biz = await w.biz("deadline");
    anna = await w.staff(biz, "Anna");
    svc = await w.service(biz, "Cut", 30);
    await w.rules(biz, { cancellationDeadlineHours: 24, rescheduleDeadlineHours: 48, minNoticeMinutes: 60 });
  });

  it("cancel: refused inside the deadline (service + database), allowed outside; the slot is freed", async () => {
    setNow(PINNED_NOW); // Sun 20:00 Berlin
    const soon = await claimed(D.mon, "10:00"); // 14 h ahead < 24 h
    const later = await claimed(D.wed, "10:00"); // 62 h ahead
    await expect(cancelMyBooking(cdeps(), c1, soon)).rejects.toMatchObject({ code: "not_manageable" });
    expect(await status(soon)).toBe("pending");
    expect((await w.admin().rpc("cancel_my_booking", { p_user_id: c1, p_appointment_id: soon })).error?.code).toBe("22023");

    expect(await w.times(biz, svc, anna, D.wed)).not.toContain("10:00");
    await cancelMyBooking(cdeps(), c1, later);
    expect(await status(later)).toBe("cancelled");
    expect(await w.times(biz, svc, anna, D.wed)).toContain("10:00");
    // the deadline is a rule of the business: with it switched off the same booking can be cancelled
    const edge = await claimed(D.mon, "17:30"); // 21.5 h ahead < 24 h
    await expect(cancelMyBooking(cdeps(), c1, edge)).rejects.toMatchObject({ code: "not_manageable" });
    await w.q("update workspaces set cancellation_deadline_hours = 0 where id = $1", [biz.ws]);
    await expect(cancelMyBooking(cdeps(), c1, edge)).resolves.toBeUndefined();
    await w.q("update workspaces set cancellation_deadline_hours = 24 where id = $1", [biz.ws]);
  });

  it("reschedule: refused inside its own deadline; outside, it moves, and the status returns to pending", async () => {
    const tue = await claimed(D.tue, "10:00"); // 38 h ahead < 48 h
    await expect(rescheduleMyBooking(cdeps(), c1, tue, D.fri, "10:00", anna)).rejects.toMatchObject({ code: "not_manageable" });
    expect((await w.admin().rpc("reschedule_my_booking", { p_user_id: c1, p_appointment_id: tue, p_new_starts_at: wallToInstant(D.fri, "10:00", "Europe/Berlin").toISOString(), p_staff_id: anna, p_resource_id: null })).error?.code).toBe("22023");

    const thu = await claimed(D.thu, "10:00"); // 86 h ahead
    await w.q("update appointments set status = 'confirmed' where id = $1", [thu]);
    await rescheduleMyBooking(cdeps(), c1, thu, D.fri, "11:00", anna);
    const moved = await w.row(thu);
    expect(moved.starts_at.toISOString()).toBe(wallToInstant(D.fri, "11:00", "Europe/Berlin").toISOString());
    expect(moved.status).toBe("pending");
    // with auto-confirm ON a move stays confirmed
    await w.rules(biz, { autoConfirm: true });
    await rescheduleMyBooking(cdeps(), c1, thu, D.fri, "12:00", anna);
    expect((await w.row(thu)).status).toBe("confirmed");
    await w.rules(biz, { autoConfirm: false });
  });

  it("reschedule honours min notice and the horizon (the target, not only the old time)", async () => {
    const id = await claimed(D.fri, "15:00");
    await w.rules(biz, { minNoticeMinutes: 60 * 24 * 3, rescheduleDeadlineHours: 0 }); // 3 days notice
    await expect(rescheduleMyBooking(cdeps(), c1, id, D.tue, "10:00", anna)).rejects.toMatchObject({ code: "slot_unavailable" }); // 38 h < 3 d
    await expect(rescheduleMyBooking(cdeps(), c1, id, "2026-10-12", "10:00", anna)).resolves.toBeUndefined();
    await w.rules(biz, { minNoticeMinutes: 60, maxHorizonDays: 10 });
    await expect(rescheduleMyBooking(cdeps(), c1, id, "2026-10-20", "10:00", anna)).rejects.toMatchObject({ code: "slot_unavailable" });
    await w.rules(biz, { maxHorizonDays: 90, rescheduleDeadlineHours: 48 });
  });

  it("reschedule onto time off, a business closure or outside opening hours is refused and offers no slot", async () => {
    const id = await claimed("2026-10-14", "10:00");
    await w.timeOff(biz, anna, "2026-10-15", "2026-10-15", undefined, "Holiday");
    await w.timeOff(biz, null, "2026-10-16", "2026-10-16");
    await w.timeOff(biz, anna, "2026-10-19", "2026-10-19", ["10:00", "12:00"]);
    expect(await getRescheduleSlots(cdeps(), c1, id, "2026-10-15")).toEqual([]);
    expect(await getRescheduleSlots(cdeps(), c1, id, "2026-10-16")).toEqual([]);
    expect((await getRescheduleSlots(cdeps(), c1, id, "2026-10-19")).map((s) => s.time)).not.toContain("10:30");
    for (const [d, t] of [["2026-10-15", "10:00"], ["2026-10-16", "10:00"], ["2026-10-19", "10:30"], ["2026-10-17", "10:00"], ["2026-10-14", "08:00"], ["2026-10-14", "17:45"], ["2026-10-14", "20:00"]] as const) {
      await expect(rescheduleMyBooking(cdeps(), c1, id, d, t, anna), `${d} ${t}`).rejects.toMatchObject({ code: "slot_unavailable" });
    }
    expect((await w.row(id)).starts_at.toISOString()).toBe(wallToInstant("2026-10-14", "10:00", "Europe/Berlin").toISOString());
    // free time inside the hours works (and the booking's own window never blocks itself)
    await expect(rescheduleMyBooking(cdeps(), c1, id, "2026-10-14", "10:15", anna)).resolves.toBeUndefined();
  });

  it("another client cannot cancel or reschedule my booking, nor see its slots", async () => {
    const id = await claimed(D.fri, "16:00");
    await expect(cancelMyBooking(cdeps(), c2, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(rescheduleMyBooking(cdeps(), c2, id, D.fri, "16:30", anna)).rejects.toMatchObject({ code: "not_found" });
    await expect(getRescheduleSlots(cdeps(), c2, id, D.fri)).rejects.toMatchObject({ code: "not_found" });
    expect(await listMyBookings(cdeps(), c2)).toEqual([]);
  });
});

describe("(5) regression: guest claim / My bookings / Business views / privacy / money buckets", () => {
  it("guest booking -> claim -> My bookings (customer-safe fields) -> cancel -> business sees the cancellation", async () => {
    const biz = await w.biz("regress");
    const anna = await w.staff(biz, "Anna");
    const svc = await w.service(biz, "Cut", 30, { price: 42 });
    const client = await w.user("guest-client");
    const d: ClientAccountDeps = { admin: w.admin(), rateLimiter: createMemoryRateLimiter() };

    const booked = await w.book(biz, svc, anna, D.wed, "10:00", { client: { name: "Gina Guest", email: "gina@example.test", phone: "+49 170 123 456", notes: "window seat" } });
    const token = (await issueBookingClaim(d, booked.appointmentId))!;
    await claimBooking(d, client, token);

    const mine = await listMyBookings(d, client);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: booked.appointmentId, workspaceSlug: biz.slug, date: D.wed, time: "10:00", endTime: "10:30", status: "pending", serviceName: "Cut", staffName: "Anna", price: 42, isUpcoming: true, canCancel: true });
    const keys = Object.keys(mine[0]);
    for (const forbidden of ["notes", "clientNotes", "financialBucket", "financialBucketId", "visibility", "clientId", "internalNotes", "createdBy"]) expect(keys).not.toContain(forbidden);

    // the Business side sees the guest and the booking
    const ownerClient = () => createPgliteSupabaseClient(db, { kind: "user", id: biz.owner });
    const clients = await createSupabaseClientsRepository(biz.ws, async () => ownerClient()).list();
    expect(clients.find((c) => c.email === "gina@example.test")).toMatchObject({ name: "Gina Guest", tags: ["new"] });
    const appts = await createSupabaseAppointmentsRepository(biz.ws, async () => ownerClient()).list();
    expect(appts.find((a) => a.id === booked.appointmentId)).toMatchObject({ client: "Gina Guest", service: "Cut", staff: "Anna", status: "pending", visibility: "normal", financialBucket: "main", price: 42, notes: "window seat" });

    await cancelMyBooking(d, client, booked.appointmentId);
    expect((await createSupabaseAppointmentsRepository(biz.ws, async () => ownerClient()).get(booked.appointmentId))?.status).toBe("cancelled");
    expect((await listMyBookings(d, client))[0]).toMatchObject({ status: "cancelled", canCancel: false });
    expect(await w.times(biz, svc, anna, D.wed)).toContain("10:00");
  });

  it("privacy visibility is unchanged: customers see only 'normal'; business roles see normal / private / owner-only by permission", async () => {
    const biz = await w.biz("privacy");
    const anna = await w.staff(biz, "Anna");
    const svc = await w.service(biz, "Cut", 30);
    const mgr = await w.member(biz, "manager");
    const stf = await w.member(biz, "staff");
    const adm = await w.member(biz, "admin");
    const cust = await w.user("cust");
    const d: ClientAccountDeps = { admin: w.admin(), rateLimiter: createMemoryRateLimiter() };
    const cl = (await w.q<{ id: string }>("insert into clients (workspace_id,name) values ($1,'Pat') returning id", [biz.ws]))[0].id;
    const ids: Record<string, string> = {};
    let h = 9;
    for (const vis of ["normal", "private", "owner_only"]) {
      ids[vis] = (
        await w.q<{ id: string }>(
          "insert into appointments (workspace_id, client_id, service_id, staff_id, starts_at, ends_at, visibility, client_notes, price, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'public') returning id",
          [biz.ws, cl, svc, anna, wallToInstant(D.wed, `${String(h).padStart(2, "0")}:00`, "Europe/Berlin"), wallToInstant(D.wed, `${String(h).padStart(2, "0")}:30`, "Europe/Berlin"), vis, `note-${vis}`, 77],
        )
      )[0].id;
      const token = (await issueBookingClaim(d, ids[vis]))!;
      await claimBooking(d, cust, token); // even a claimed private/owner-only row must stay invisible to the customer
      h++;
    }
    expect((await listMyBookings(d, cust)).map((b) => b.id)).toEqual([ids.normal]);
    await expect(cancelMyBooking(d, cust, ids.private)).rejects.toMatchObject({ code: "not_found" });
    await expect(cancelMyBooking(d, cust, ids.owner_only)).rejects.toMatchObject({ code: "not_found" });
    expect((await w.row(ids.private)).status).toBe("pending");

    const view = async (user: string) => {
      const list = await createSupabaseAppointmentsRepository(biz.ws, async () => createPgliteSupabaseClient(db, { kind: "user", id: user })).list();
      return Object.fromEntries(Object.entries(ids).map(([vis, id]) => [vis, list.find((a) => a.id === id)]));
    };
    const owner = await view(biz.owner);
    expect(owner.private).toMatchObject({ client: "Pat", notes: "note-private", price: 77 });
    expect(owner.owner_only).toMatchObject({ client: "Pat", notes: "note-owner_only", price: 77 });
    const manager = await view(mgr); // no private_records.view / owner_records.view: masked placeholders
    expect(manager.normal).toMatchObject({ client: "Pat" });
    expect(manager.private).toMatchObject({ client: "", notes: "", price: 0, visibility: "private" });
    expect(manager.owner_only).toMatchObject({ client: "", notes: "", price: 0 });
    const staffView = await view(stf);
    expect(staffView.private?.client).toBe("");
    const adminView = await view(adm); // admin has neither private nor owner permission
    expect(adminView.private?.client).toBe("");
    expect(adminView.owner_only?.client).toBe("");
  });

  it("financial buckets: public bookings land in the MAIN account, the guest cannot choose; the PRIVATE account stays invisible to roles without permission", async () => {
    const biz = await w.biz("money");
    const anna = await w.staff(biz, "Anna");
    const svc = await w.service(biz, "Cut", 30);
    const stf = await w.member(biz, "staff");
    const r = await w.book(biz, svc, anna, D.wed, "10:00", { financialBucket: "private", financialBucketId: "00000000-0000-4000-8000-000000000000" } as never);
    const row = (await w.q<{ kind: string; visibility: string }>("select b.kind::text kind, a.visibility::text visibility from appointments a join financial_buckets b on b.id = a.financial_bucket_id where a.id = $1", [r.appointmentId]))[0];
    expect(row).toEqual({ kind: "main", visibility: "normal" });
    expect((await createPgliteSupabaseClient(db, { kind: "user", id: stf }).from("financial_buckets").select("kind")).data).toEqual([]);
    const staffList = await createSupabaseAppointmentsRepository(biz.ws, async () => createPgliteSupabaseClient(db, { kind: "user", id: stf })).list();
    expect(staffList.find((a) => a.id === r.appointmentId)?.financialBucket).toBe("main");
  });

  it("another business's guest booking never shows up in my Business views (appointments/clients)", async () => {
    const x = await w.biz("iso-x");
    const y = await w.biz("iso-y");
    const ax = await w.staff(x, "X-Anna");
    const sx = await w.service(x, "Cut", 30);
    await w.staff(y, "Y-Anna");
    await w.book(x, sx, ax, D.wed, "10:00");
    const asY = (ws: Biz) => async () => createPgliteSupabaseClient(db, { kind: "user", id: ws.owner });
    expect(await createSupabaseAppointmentsRepository(y.ws, asY(y)).list()).toEqual([]);
    expect(await createSupabaseClientsRepository(y.ws, asY(y)).list()).toEqual([]);
  });
});
