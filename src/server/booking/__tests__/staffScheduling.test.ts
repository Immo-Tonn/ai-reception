import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

// Same harness as businessProfile.test.ts: the services call createSupabaseServerClient(); point it at a real
// Postgres (PGlite running every migration), acting as whichever user the test selects.
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
const { RepositoryForbiddenError, RepositoryNotFoundError } = await import("@/server/repository/errors");
const { BusinessRuleError } = await import("@/server/services/businessRuleError");
const { toActionError } = await import("@/server/actions/result");
const { ZodError } = await import("zod");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const MANAGER = "cccccccc-0000-4000-8000-0000000000c3";
const STAFF = "dddddddd-0000-4000-8000-0000000000d4";
const OTHER = "eeeeeeee-0000-4000-8000-0000000000e5";

let db: PGlite;
let slug: string;
let wsId: string;
let otherSlug: string;
let otherWs: string;
let svcCut: string;
let svcColor: string;
let otherSvc: string;
let otherStaff: string;
let clientId: string;

const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const service = () => createPgliteSupabaseClient(db, { kind: "service" });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const ownerSession = async () => (as(OWNER), getSession(slug));

const week = (over: Record<number, { start: string; end: string }[]> = {}) => ({
  1: [{ start: "09:00", end: "17:00" }],
  2: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
  ...over,
});

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@test.invalid'),('${MANAGER}','m@test.invalid'),('${STAFF}','s@test.invalid'),('${OTHER}','x@test.invalid')`);
  const prov = async (user: string, email: string, name: string, base: string) =>
    ((await service().rpc("provision_workspace", { p_user_id: user, p_email: email, p_full_name: "", p_business_name: name, p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[])[0];
  const a = await prov(OWNER, "o@test.invalid", "Biz", "sched-biz");
  wsId = a.out_workspace_id;
  slug = a.out_slug;
  const b = await prov(OTHER, "x@test.invalid", "Other", "sched-other");
  otherWs = b.out_workspace_id;
  otherSlug = b.out_slug;
  await db.exec(`insert into profiles (id,email) values ('${MANAGER}','m@test.invalid'),('${STAFF}','s@test.invalid') on conflict do nothing;
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${MANAGER}','manager'),('${wsId}','${STAFF}','staff')`);
  svcCut = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Cut',30,40) returning id", [wsId]))[0].id;
  svcColor = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Color',60,90) returning id", [wsId]))[0].id;
  otherSvc = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Theirs',30,10) returning id", [otherWs]))[0].id;
  otherStaff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [otherWs]))[0].id;
  clientId = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Walk-in','w@example.test') returning id", [wsId]))[0].id;
}, 90_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

const auditCount = async (entity: string) => Number((await q<{ n: string }>("select count(*)::text n from audit_logs where workspace_id=$1 and entity_type=$2", [wsId, entity]))[0].n);

describe("Staff write side", () => {
  let anna: string;

  it("creates staff with title, colour, order and service links (+ one audit entry)", async () => {
    const session = await ownerSession();
    const before = await auditCount("staff");
    const created = await staffSvc.createStaff(session, { name: "Anna", title: "Stylist", colorToken: "--color-accent-mint", serviceIds: [svcCut] });
    anna = created.id;
    expect(created).toMatchObject({ name: "Anna", title: "Stylist", colorToken: "--color-accent-mint", active: true, scheduleMode: "inherit", serviceIds: [svcCut] });
    expect(created.sortOrder).toBeGreaterThan(0);
    expect(await q("select service_id from service_staff where staff_id=$1", [anna])).toEqual([{ service_id: svcCut }]);
    expect(await auditCount("staff")).toBe(before + 1);
  });

  it("updates fields and diffs the service links", async () => {
    const session = await ownerSession();
    const updated = await staffSvc.updateStaff(session, anna, { name: "Anna K.", title: "Senior", serviceIds: [svcColor] });
    expect(updated).toMatchObject({ name: "Anna K.", title: "Senior", serviceIds: [svcColor] });
    expect(await q("select service_id from service_staff where staff_id=$1", [anna])).toEqual([{ service_id: svcColor }]);
    expect((await staffSvc.listStaffAdmin(session)).map((s) => s.name)).toContain("Anna K.");
  });

  it("rejects invalid input", async () => {
    const session = await ownerSession();
    await expect(staffSvc.createStaff(session, { name: "  " })).rejects.toBeInstanceOf(ZodError);
    await expect(staffSvc.createStaff(session, { name: "X", colorToken: "red" as never })).rejects.toBeInstanceOf(ZodError);
    await expect(staffSvc.createStaff(session, { name: "X", serviceIds: ["nope"] })).rejects.toBeInstanceOf(ZodError);
    await expect(staffSvc.updateStaff(session, anna, { title: "x".repeat(81) })).rejects.toBeInstanceOf(ZodError);
  });

  it("deactivate keeps history: the person and their appointments stay readable, hard delete is refused", async () => {
    const session = await ownerSession();
    await q("insert into appointments (workspace_id, staff_id, client_id, starts_at, ends_at) values ($1,$2,$3,now() + interval '2 day', now() + interval '2 day 1 hour')", [wsId, anna, clientId]);
    const off = await staffSvc.setStaffActive(session, anna, false);
    expect(off.active).toBe(false);
    expect((await staffSvc.listStaffAdmin(session)).find((s) => s.id === anna)?.name).toBe("Anna K.");
    expect(await q("select staff_id from appointments where staff_id=$1", [anna])).toHaveLength(1);
    const hard = await service().from("staff_profiles").delete().eq("id", anna);
    expect(hard.error).toBeTruthy();
    expect(await q("select 1 from staff_profiles where id=$1", [anna])).toHaveLength(1);
    expect((await staffSvc.setStaffActive(session, anna, true)).active).toBe(true);
    expect(await auditCount("staff")).toBeGreaterThanOrEqual(4);
  });

  it("manager and staff cannot manage staff", async () => {
    for (const id of [MANAGER, STAFF]) {
      const s = await (as(id), getSession(slug));
      await expect(staffSvc.createStaff(s, { name: "Nope" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(staffSvc.updateStaff(s, anna, { name: "Nope" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(staffSvc.setStaffActive(s, anna, false)).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(staffSvc.setStaffSchedule(s, anna, { mode: "inherit" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(staffSvc.listStaffAdmin(s)).rejects.toBeInstanceOf(PermissionDeniedError);
    }
    expect((await q<{ name: string }>("select name from staff_profiles where id=$1", [anna]))[0].name).toBe("Anna K.");
  });

  it("tenant isolation: owner B cannot read or touch A's staff, nor link A's services", async () => {
    as(OTHER);
    await expect(getSession(slug)).rejects.toThrow();
    const b = await getSession(otherSlug);
    await expect(staffSvc.updateStaff(b, anna, { name: "Hacked" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(staffSvc.setStaffActive(b, anna, false)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(staffSvc.createStaff(b, { name: "Spy", serviceIds: [svcCut] })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    // A forged session for A's workspace is stopped by Row Level Security, not by the app.
    const forged = { userId: OTHER, workspaceId: wsId, role: "owner" as const };
    await expect(staffSvc.createStaff(forged, { name: "Forged" })).rejects.toThrow();
    expect(await q("select 1 from staff_profiles where workspace_id=$1 and name in ('Forged','Spy','Hacked')", [wsId])).toHaveLength(0);
    expect((await staffSvc.listStaffAdmin(b)).map((s) => s.id)).not.toContain(anna);
  });

  it("custom schedule: replaces intervals then flips the mode; inherit keeps the rows", async () => {
    const session = await ownerSession();
    const custom = await staffSvc.setStaffSchedule(session, anna, { mode: "custom", weekly: week({ 3: [{ start: "10:00", end: "14:00" }] }) as never });
    expect(custom.scheduleMode).toBe("custom");
    const snap = await hoursSvc.getWorkingHours(session);
    expect(snap.staff[anna][2]).toEqual([{ start: "09:00", end: "12:00" }, { start: "13:00", end: "18:00" }]);
    expect(snap.staff[anna][3]).toEqual([{ start: "10:00", end: "14:00" }]);
    expect(snap.staff[anna][0]).toEqual([]);
    const inherit = await staffSvc.setStaffSchedule(session, anna, { mode: "inherit" });
    expect(inherit.scheduleMode).toBe("inherit");
    expect((await hoursSvc.getWorkingHours(session)).staff[anna][1]).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("an invalid custom schedule changes nothing (mode and rows)", async () => {
    const session = await ownerSession();
    const before = await q("select weekday,start_time,end_time,is_day_off from working_hours where staff_id=$1 order by weekday,start_time", [anna]);
    await expect(staffSvc.setStaffSchedule(session, anna, { mode: "custom", weekly: week({ 4: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }] }) as never })).rejects.toBeInstanceOf(ZodError);
    expect(await q("select schedule_mode from staff_profiles where id=$1", [anna])).toEqual([{ schedule_mode: "inherit" }]);
    expect(await q("select weekday,start_time,end_time,is_day_off from working_hours where staff_id=$1 order by weekday,start_time", [anna])).toEqual(before);
  });
});

describe("Working hours (replace-all)", () => {
  it("saves several intervals per day, closed days explicitly, and replaces on the next save", async () => {
    const session = await ownerSession();
    const saved = await hoursSvc.replaceBusinessWorkingHours(session, week());
    expect(saved[1]).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(saved[2]).toHaveLength(2);
    expect(saved[0]).toEqual([]);
    expect(await q("select count(*)::int n from working_hours where workspace_id=$1 and staff_id is null and is_day_off", [wsId])).toEqual([{ n: 5 }]);
    const again = await hoursSvc.replaceBusinessWorkingHours(session, { 5: [{ start: "08:00", end: "12:00" }] });
    expect(again[1]).toEqual([]);
    expect(again[5]).toEqual([{ start: "08:00", end: "12:00" }]);
    expect(await q("select count(*)::int n from working_hours where workspace_id=$1 and staff_id is null", [wsId])).toEqual([{ n: 7 }]);
    expect(await auditCount("workingHours")).toBeGreaterThanOrEqual(2);
  });

  it("rejects bad times, end <= start, overlap, more than 4 intervals and bad weekdays - leaving the schedule untouched", async () => {
    const session = await ownerSession();
    const snapshot = await q("select weekday,start_time,end_time,is_day_off from working_hours where workspace_id=$1 and staff_id is null order by weekday,start_time", [wsId]);
    const bad: Record<string, unknown>[] = [
      { 1: [{ start: "9:00", end: "17:00" }] },
      { 1: [{ start: "24:00", end: "25:00" }] },
      { 1: [{ start: "10:00", end: "10:00" }] },
      { 1: [{ start: "12:00", end: "10:00" }] },
      { 1: [{ start: "09:00", end: "12:00" }, { start: "11:59", end: "14:00" }] },
      { 1: [1, 2, 3, 4, 5].map((i) => ({ start: `0${i}:00`, end: `0${i}:30` })) },
      { 7: [{ start: "09:00", end: "10:00" }] },
    ];
    for (const weekly of bad) await expect(hoursSvc.replaceBusinessWorkingHours(session, weekly as never)).rejects.toBeInstanceOf(ZodError);
    expect(await q("select weekday,start_time,end_time,is_day_off from working_hours where workspace_id=$1 and staff_id is null order by weekday,start_time", [wsId])).toEqual(snapshot);
  });

  it("touching intervals (09-12, 12-18) are allowed", async () => {
    const session = await ownerSession();
    const r = await hoursSvc.replaceBusinessWorkingHours(session, { 1: [{ start: "12:00", end: "18:00" }, { start: "09:00", end: "12:00" }] });
    expect(r[1]).toEqual([{ start: "09:00", end: "12:00" }, { start: "12:00", end: "18:00" }]);
  });

  it("atomicity (migration 0020): a failing replace leaves the previous schedule untouched", async () => {
    const session = await ownerSession();
    await hoursSvc.replaceBusinessWorkingHours(session, week());
    const sql = "select weekday,start_time,end_time,is_day_off from working_hours where workspace_id=$1 and staff_id is null order by weekday,start_time";
    const before = await q(sql, [wsId]);
    // Straight at the database function: two overlapping rows on Wednesday make the trigger refuse the insert
    // AFTER the delete step ran inside the same call; the whole call must roll back.
    const { error } = await current.rpc("replace_working_hours", {
      p_workspace_id: wsId,
      p_staff_id: null,
      p_rows: [
        { weekday: 3, start_time: "09:00", end_time: "13:00", is_day_off: false },
        { weekday: 3, start_time: "12:00", end_time: "18:00", is_day_off: false },
      ],
    });
    expect(error).toBeTruthy();
    expect(await q(sql, [wsId])).toEqual(before);
  });

  it("only staff.manage may replace hours; another tenant cannot touch them", async () => {
    for (const id of [MANAGER, STAFF]) {
      const s = await (as(id), getSession(slug));
      await expect(hoursSvc.replaceBusinessWorkingHours(s, week())).rejects.toBeInstanceOf(PermissionDeniedError);
    }
    as(OTHER);
    const forged = { userId: OTHER, workspaceId: wsId, role: "owner" as const };
    const before = await q("select count(*)::int n from working_hours where workspace_id=$1", [wsId]);
    await hoursSvc.replaceBusinessWorkingHours(forged, week()).catch(() => undefined);
    expect(await q("select count(*)::int n from working_hours where workspace_id=$1", [wsId])).toEqual(before);
    await expect(hoursSvc.replaceStaffWorkingHours(await getSession(otherSlug), (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1 limit 1", [wsId]))[0].id, week())).rejects.toBeInstanceOf(RepositoryNotFoundError);
  });
});

describe("Time off", () => {
  let closure: string;
  let leave: string;

  it("creates a business closure (full days) and a staff partial day; the reason stays out of the audit log", async () => {
    const session = await ownerSession();
    const staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1 order by created_at limit 1", [wsId]))[0].id;
    const c = await hoursSvc.createTimeOff(session, { staffId: null, startDate: "2030-12-24", endDate: "2030-12-26", reason: "Christmas secret" });
    closure = c.id;
    expect(c).toMatchObject({ staffId: null, startDate: "2030-12-24", endDate: "2030-12-26", startTime: null, endTime: null, reason: "Christmas secret" });
    const p = await hoursSvc.createTimeOff(session, { staffId, startDate: "2030-05-02", endDate: "2030-05-02", startTime: "13:00", endTime: "15:30", reason: "Doctor" });
    leave = p.id;
    expect(p).toMatchObject({ startTime: "13:00", endTime: "15:30" });
    expect((await hoursSvc.listTimeOff(session)).map((t) => t.id)).toEqual(expect.arrayContaining([closure, leave]));
    const logs = JSON.stringify(await q("select summary from audit_logs where workspace_id=$1 and entity_type='timeOff'", [wsId]));
    expect(logs).not.toMatch(/secret|Doctor/);
    expect(await auditCount("timeOff")).toBe(2);
  });

  it("rejects bad ranges and half-specified partial days", async () => {
    const session = await ownerSession();
    const base = { staffId: null, startDate: "2030-06-01", endDate: "2030-06-01" };
    await expect(hoursSvc.createTimeOff(session, { ...base, endDate: "2030-05-31" })).rejects.toBeInstanceOf(ZodError);
    await expect(hoursSvc.createTimeOff(session, { ...base, startDate: "2030-02-30", endDate: "2030-02-30" })).rejects.toBeInstanceOf(ZodError);
    await expect(hoursSvc.createTimeOff(session, { ...base, startTime: "10:00" })).rejects.toBeInstanceOf(ZodError);
    await expect(hoursSvc.createTimeOff(session, { ...base, startTime: "11:00", endTime: "10:00" })).rejects.toBeInstanceOf(ZodError);
    await expect(hoursSvc.createTimeOff(session, { ...base, endDate: "2030-06-02", startTime: "10:00", endTime: "11:00" })).rejects.toBeInstanceOf(ZodError);
    await expect(hoursSvc.createTimeOff(session, { ...base, reason: "x".repeat(201) })).rejects.toBeInstanceOf(ZodError);
  });

  it("refuses another tenant's staff, other roles, and cross-tenant delete; deletes its own", async () => {
    const session = await ownerSession();
    await expect(hoursSvc.createTimeOff(session, { staffId: otherStaff, startDate: "2030-06-01", endDate: "2030-06-01" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    for (const id of [MANAGER, STAFF]) {
      const s = await (as(id), getSession(slug));
      await expect(hoursSvc.createTimeOff(s, { staffId: null, startDate: "2030-06-01", endDate: "2030-06-01" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(hoursSvc.deleteTimeOff(s, closure)).rejects.toBeInstanceOf(PermissionDeniedError);
    }
    as(OTHER);
    await expect(hoursSvc.deleteTimeOff(await getSession(otherSlug), closure)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    const owner = await ownerSession();
    await hoursSvc.deleteTimeOff(owner, closure);
    await hoursSvc.deleteTimeOff(owner, leave);
    expect(await hoursSvc.listTimeOff(owner)).toEqual([]);
    expect(await auditCount("timeOff")).toBe(4);
  });
});

describe("Resources write side", () => {
  let room: string;

  it("creates a resource; linking sets the service's required type and the link", async () => {
    const session = await ownerSession();
    const r = await resSvc.createResource(session, { name: "Room 1", type: "room", description: "Window", serviceIds: [svcCut] });
    room = r.id;
    expect(r).toMatchObject({ name: "Room 1", type: "room", description: "Window", active: true, serviceIds: [svcCut] });
    expect(await q("select required_resource_type from services where id=$1", [svcCut])).toEqual([{ required_resource_type: "room" }]);
    expect(await auditCount("resource")).toBe(1);
  });

  it("refuses a link to a service that requires another type; type change with links is refused", async () => {
    const session = await ownerSession();
    const van = await resSvc.createResource(session, { name: "Van", type: "vehicle" });
    await expect(resSvc.updateResource(session, van.id, { serviceIds: [svcCut] })).rejects.toBeInstanceOf(BusinessRuleError);
    expect(toActionError(new BusinessRuleError("x", "resource_type_mismatch"))).toBe("conflict");
    await expect(resSvc.updateResource(session, room, { type: "equipment" })).rejects.toBeInstanceOf(BusinessRuleError);
    await expect(resSvc.createResource(session, { name: "Chair", type: "equipment", serviceIds: [svcCut] })).rejects.toBeInstanceOf(BusinessRuleError);
    expect(await q("select 1 from resources where workspace_id=$1 and name='Chair'", [wsId])).toHaveLength(0);
    // Unlink, then the type may change; unlinking never clears the service's required type.
    await resSvc.updateResource(session, room, { serviceIds: [] });
    expect(await q("select required_resource_type from services where id=$1", [svcCut])).toEqual([{ required_resource_type: "room" }]);
    expect((await resSvc.updateResource(session, room, { type: "custom", name: "Studio" })).type).toBe("custom");
  });

  it("deactivate keeps appointment history; hard delete is refused", async () => {
    const session = await ownerSession();
    await q("insert into appointments (workspace_id, resource_id, client_id, starts_at, ends_at) values ($1,$2,$3,now() + interval '3 day', now() + interval '3 day 1 hour')", [wsId, room, clientId]);
    expect((await resSvc.setResourceActive(session, room, false)).active).toBe(false);
    expect((await resSvc.listResourcesAdmin(session)).find((r) => r.id === room)?.name).toBe("Studio");
    expect(await q("select resource_id from appointments where resource_id=$1", [room])).toHaveLength(1);
    expect((await service().from("resources").delete().eq("id", room)).error).toBeTruthy();
  });

  it("denies other roles, other tenants and foreign service ids", async () => {
    for (const id of [MANAGER, STAFF]) {
      const s = await (as(id), getSession(slug));
      await expect(resSvc.createResource(s, { name: "Nope", type: "room" })).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(resSvc.setResourceActive(s, room, true)).rejects.toBeInstanceOf(PermissionDeniedError);
    }
    as(OTHER);
    const b = await getSession(otherSlug);
    await expect(resSvc.updateResource(b, room, { name: "Hacked" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(resSvc.createResource(b, { name: "Spy", type: "room", serviceIds: [svcColor] })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    const owner = await ownerSession();
    await expect(resSvc.createResource(owner, { name: "X", type: "room", serviceIds: [otherSvc] })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(resSvc.createResource(owner, { name: "X", type: "boat" as never })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("Booking rules", () => {
  const ok = { autoConfirm: true, minNoticeMinutes: 120, maxHorizonDays: 60, slotIntervalMinutes: 30, cancellationDeadlineHours: 24, rescheduleDeadlineHours: 48 };

  it("defaults, then saves every rule (auto-confirm uses the existing column)", async () => {
    const session = await ownerSession();
    expect(await rulesSvc.getBookingRules(session)).toMatchObject({ autoConfirm: false, minNoticeMinutes: 0, maxHorizonDays: 90, slotIntervalMinutes: 15, cancellationDeadlineHours: 0, rescheduleDeadlineHours: 0 });
    expect(await rulesSvc.updateBookingRules(session, ok)).toEqual(ok);
    expect(await q("select auto_confirm_bookings, min_notice_minutes, max_horizon_days, slot_interval_minutes, cancellation_deadline_hours, reschedule_deadline_hours from workspaces where id=$1", [wsId]))
      .toEqual([{ auto_confirm_bookings: true, min_notice_minutes: 120, max_horizon_days: 60, slot_interval_minutes: 30, cancellation_deadline_hours: 24, reschedule_deadline_hours: 48 }]);
    expect(await auditCount("bookingRules")).toBe(1);
  });

  it("rejects out-of-range values", async () => {
    const session = await ownerSession();
    for (const bad of [{ maxHorizonDays: 0 }, { maxHorizonDays: 181 }, { slotIntervalMinutes: 7 }, { slotIntervalMinutes: 45 }, { minNoticeMinutes: -1 }, { cancellationDeadlineHours: 721 }, { rescheduleDeadlineHours: -2 }, { maxHorizonDays: 1, minNoticeMinutes: 1440 }, { maxHorizonDays: 1.5 }]) {
      await expect(rulesSvc.updateBookingRules(session, { ...ok, ...bad })).rejects.toBeInstanceOf(ZodError);
    }
    for (const n of [5, 10, 15, 20, 30, 60]) await rulesSvc.updateBookingRules(session, { ...ok, slotIntervalMinutes: n });
    expect(await rulesSvc.updateBookingRules(session, { ...ok, maxHorizonDays: 180 })).toMatchObject({ maxHorizonDays: 180 });
  });

  it("manager and staff cannot change the rules; another tenant cannot either", async () => {
    for (const id of [MANAGER, STAFF]) {
      const s = await (as(id), getSession(slug));
      await expect(rulesSvc.updateBookingRules(s, { ...ok, autoConfirm: false })).rejects.toBeInstanceOf(PermissionDeniedError);
    }
    as(OTHER);
    await expect(rulesSvc.updateBookingRules({ userId: OTHER, workspaceId: wsId, role: "owner" }, { ...ok, autoConfirm: false })).rejects.toThrow();
    expect((await q<{ a: boolean }>("select auto_confirm_bookings a from workspaces where id=$1", [wsId]))[0].a).toBe(true);
  });
});

describe("Demo workspaces are read-only", () => {
  const demo = { userId: "demo-user", workspaceId: "demo-salon", role: "owner" as const };
  it("every write is refused with 'forbidden' before any database access", async () => {
    current = undefined as unknown as SupabaseClient; // any database access would throw a TypeError, not a Forbidden
    const attempts = [
      () => staffSvc.createStaff(demo, { name: "X" }),
      () => staffSvc.updateStaff(demo, "x", { name: "X" }),
      () => staffSvc.setStaffActive(demo, "x", false),
      () => staffSvc.setStaffSchedule(demo, "x", { mode: "inherit" }),
      () => resSvc.createResource(demo, { name: "X", type: "room" }),
      () => resSvc.updateResource(demo, "x", { name: "X" }),
      () => resSvc.setResourceActive(demo, "x", false),
      () => hoursSvc.replaceBusinessWorkingHours(demo, week()),
      () => hoursSvc.replaceStaffWorkingHours(demo, "x", week()),
      () => hoursSvc.createTimeOff(demo, { staffId: null, startDate: "2030-01-01", endDate: "2030-01-01" }),
      () => hoursSvc.deleteTimeOff(demo, "x"),
      () => rulesSvc.updateBookingRules(demo, { autoConfirm: true, minNoticeMinutes: 0, maxHorizonDays: 90, slotIntervalMinutes: 15, cancellationDeadlineHours: 0, rescheduleDeadlineHours: 0 }),
    ];
    for (const attempt of attempts) {
      const error = await attempt().then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(RepositoryForbiddenError);
      expect(toActionError(error)).toBe("forbidden");
    }
  });
});
