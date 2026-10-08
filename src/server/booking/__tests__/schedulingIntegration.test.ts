import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { createSupabaseAppointmentsRepository } from "@/server/repository/appointmentsSupabaseRepository";
import { instantToWall, wallToInstant } from "@/lib/time/zonedTime";
import { computeSlotsFor } from "@/features/appointments/availability";
import { demoWorkspaces } from "@/features/workspace/registry";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import { D, grid, makeWorld, PINNED_NOW, type World } from "./schedulingHarness";

// Services under test call createSupabaseServerClient(); point it at PGlite as the user the test selects.
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const rulesSvc = await import("@/server/services/bookingRules.service");

/**
 * Agent D - REAL integration tests of the full guest flow with the staff-scheduling rules (migration 0019).
 * PGlite runs every migration; the real server services and the real availability engine run on top; nothing
 * is mocked between them. The clock is pinned (PGlite's now() follows Date): Sun 2026-10-04 20:00 Berlin.
 */
let db: PGlite;
let w: World;

const setNow = (iso: string) => vi.setSystemTime(new Date(iso));

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setNow(PINNED_NOW);
  db = await createMigratedDb();
  w = makeWorld(db);
}, 120_000);
beforeEach(() => setNow(PINNED_NOW));
afterAll(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("(1) guest flow: opening hours", () => {
  it("a closed weekday offers nothing and a forged booking on it is refused", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    expect(await w.times(b, svc, anna, D.sun)).toEqual([]);
    expect(await w.times(b, svc, anna, D.sat)).toEqual([]);
    expect(await w.outcome(w.book(b, svc, anna, D.sat, "10:00"))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, null, D.sun, "10:00"))).toBe("slot_unavailable");
    expect((await w.times(b, svc, anna, D.mon)).length).toBeGreaterThan(0);
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "10:00"))).toBe("ok");
    expect(await w.q("select 1 from appointments where workspace_id = $1", [b.ws])).toHaveLength(1);
  });

  it("several intervals per weekday: a 50-minute service never spans the lunch gap", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Treatment", 50);
    await w.setHours(b, null, { 1: [["09:00", "12:00"], ["13:00", "17:00"]] });
    const t = await w.times(b, svc, anna, D.mon);
    // morning: last start 11:00 (ends 11:50); afternoon: 13:00..16:00 (16:15 would end 17:05)
    expect(t).toEqual([...grid("09:00", "11:00"), ...grid("13:00", "16:00")]);
    for (const gap of ["11:15", "11:30", "11:45", "12:00", "12:30", "12:45"]) {
      expect(await w.outcome(w.book(b, svc, anna, D.mon, gap))).toBe("slot_unavailable");
    }
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "11:00"))).toBe("ok");
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "13:00"))).toBe("ok");
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "16:15"))).toBe("slot_unavailable");
  });

  it("a day-off row closes the day even when other weekdays have intervals", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    await w.setHours(b, null, { 1: [["09:00", "12:00"]], 3: [["10:00", "12:00"]] });
    expect(await w.times(b, svc, anna, D.tue)).toEqual([]);
    expect(await w.times(b, svc, anna, D.wed)).toEqual(grid("10:00", "11:30"));
  });
});

describe("(1) guest flow: staff schedule modes", () => {
  it("custom narrows the business hours, inherit ignores stale own rows, a custom day outside the business hours stays closed", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna", { mode: "custom", hours: { 1: [["10:00", "12:00"], ["14:00", "16:00"]], 6: [["10:00", "14:00"]] } });
    const lisa = await w.staff(b, "Lisa", { mode: "inherit" });
    // Lisa keeps old own rows, but she is on "inherit": they must be ignored.
    await w.setHours(b, lisa, { 1: [["12:00", "13:00"]] });
    const svc = await w.service(b, "Cut", 30);

    expect(await w.times(b, svc, anna, D.mon)).toEqual([...grid("10:00", "11:30"), ...grid("14:00", "15:30")]);
    expect(await w.times(b, svc, anna, D.sat)).toEqual([]); // business is closed Saturday: custom can only narrow
    expect(await w.times(b, svc, lisa, D.mon)).toEqual(grid("09:00", "17:30"));

    // any specialist at 09:00 Monday: only Lisa is there
    expect((await w.slots(b, svc, null, D.mon)).filter((s) => s.time === "09:00").map((s) => s.staffId)).toEqual([lisa]);
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "09:00"))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "12:00"))).toBe("slot_unavailable"); // lunch gap of her own schedule
    expect(await w.outcome(w.book(b, svc, lisa, D.mon, "09:00"))).toBe("ok");
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "10:00"))).toBe("ok");
  });

  it("a custom schedule wider than the business is clipped to the business hours", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna", { mode: "custom", hours: { 1: [["06:00", "22:00"]] } });
    const svc = await w.service(b, "Cut", 30);
    expect(await w.times(b, svc, anna, D.mon)).toEqual(grid("09:00", "17:30"));
  });

  it("a custom schedule with no rows at all is closed (nothing was entered), not 'open all day'", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna", { mode: "custom" });
    const svc = await w.service(b, "Cut", 30);
    expect(await w.times(b, svc, anna, D.mon)).toEqual([]);
  });

  it("a business with no opening-hour rows is closed for everybody (default deny)", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    await w.q("delete from working_hours where workspace_id = $1", [b.ws]);
    expect(await w.times(b, svc, anna, D.mon)).toEqual([]);
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "10:00"))).toBe("slot_unavailable");
  });
});

describe("(1) guest flow: closures and time off", () => {
  it("a business closure beats a staff member's custom hours (full day) and blocks partial windows", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna", { mode: "custom", hours: { 2: [["09:00", "18:00"]], 3: [["09:00", "18:00"]] } });
    const lisa = await w.staff(b, "Lisa");
    const svc = await w.service(b, "Cut", 30);
    await w.timeOff(b, null, D.tue, D.tue);
    await w.timeOff(b, null, D.wed, D.wed, ["12:00", "14:00"]);

    for (const who of [anna, lisa, null]) expect(await w.times(b, svc, who, D.tue)).toEqual([]);
    expect(await w.outcome(w.book(b, svc, anna, D.tue, "10:00"))).toBe("slot_unavailable");

    const wed = await w.times(b, svc, anna, D.wed);
    expect(wed).toEqual([...grid("09:00", "11:30"), ...grid("14:00", "17:30")]);
    expect(await w.outcome(w.book(b, svc, lisa, D.wed, "11:45"))).toBe("slot_unavailable"); // would end 12:15
    expect(await w.outcome(w.book(b, svc, lisa, D.wed, "11:30"))).toBe("ok"); // ends exactly 12:00
  });

  it("staff time off: a full day (and a multi-day range) closes only that person; a partial day only its window", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const lisa = await w.staff(b, "Lisa");
    const svc = await w.service(b, "Cut", 30);
    await w.timeOff(b, lisa, D.mon, D.tue, undefined, "Surgery");
    await w.timeOff(b, anna, D.fri, D.fri, ["10:00", "12:00"], "Dentist");

    expect(await w.times(b, svc, lisa, D.mon)).toEqual([]);
    expect(await w.times(b, svc, lisa, D.tue)).toEqual([]);
    expect(await w.times(b, svc, lisa, D.wed)).toEqual(grid("09:00", "17:30")); // day after the range
    expect(await w.times(b, svc, anna, D.mon)).toEqual(grid("09:00", "17:30")); // others unaffected
    expect([...new Set((await w.slots(b, svc, null, D.mon)).map((s) => s.staffId))]).toEqual([anna]);
    expect(await w.outcome(w.book(b, svc, lisa, D.tue, "10:00"))).toBe("slot_unavailable");

    expect(await w.times(b, svc, anna, D.fri)).toEqual([...grid("09:00", "09:30"), ...grid("12:00", "17:30")]);
    expect(await w.outcome(w.book(b, svc, anna, D.fri, "09:45"))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, anna, D.fri, "09:30"))).toBe("ok");
    expect(await w.outcome(w.book(b, svc, anna, D.fri, "12:00"))).toBe("ok");
    // Lisa works while Anna is out
    expect(await w.outcome(w.book(b, svc, lisa, D.fri, "10:30"))).toBe("ok");
  });
});

describe("(1) guest flow: slot grid, buffers", () => {
  it.each([
    [15, grid("09:00", "11:15", 15)],
    [30, grid("09:00", "11:00", 30)],
    [60, grid("09:00", "11:00", 60)],
  ])("slot interval %i min: starts lie on the clock grid and the whole 45-min service fits", async (interval, expected) => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 45);
    await w.rules(b, { slotIntervalMinutes: interval });
    await w.setHours(b, null, { 1: [["09:00", "12:00"]] });
    expect(await w.times(b, svc, anna, D.mon)).toEqual(expected);
    // an off-grid start is refused even though the minutes are free
    const off = interval === 15 ? "09:10" : "09:15";
    expect(await w.outcome(w.book(b, svc, anna, D.mon, off))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, anna, D.mon, expected[0]))).toBe("ok");
  });

  it("buffers are part of the busy window: stored busy_from/busy_until and the next offered start", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Colour", 30, { before: 10, after: 15 });
    await w.setHours(b, null, { 1: [["09:00", "12:00"]] });
    const r = await w.book(b, svc, anna, D.mon, "09:00");
    const row = await w.row(r.appointmentId);
    expect(instantToWall(row.busy_from, "Europe/Berlin").time).toBe("08:50");
    expect(instantToWall(row.busy_until, "Europe/Berlin").time).toBe("09:45");
    // next start s needs s-10 >= 09:45 -> first grid point 10:00
    const t = await w.times(b, svc, anna, D.mon);
    expect(t[0]).toBe("10:00");
    for (const x of ["09:00", "09:15", "09:30", "09:45"]) expect(t).not.toContain(x);
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "09:45"))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "10:00"))).toBe("ok");
    // a no-buffer service of the same person may start right after the busy window ends (09:45 is free for a 0/0 service)
    const plain = await w.service(b, "Plain", 15);
    const r2 = await w.book(b, plain, anna, D.mon, "11:00");
    expect(r2.time).toBe("11:00");
  });
});

describe("(1) guest flow: minimum notice, horizon, Europe/Berlin", () => {
  it("min notice applies from the injected 'now' (Berlin clock): earlier starts are neither offered nor bookable, in the engine and in the database", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    await w.rules(b, { minNoticeMinutes: 180 });
    setNow("2026-10-05T07:00:00Z"); // Mon 09:00 Berlin
    const t = await w.times(b, svc, anna, D.mon);
    expect(t[0]).toBe("12:00");
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "11:45"))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "12:00"))).toBe("ok");
    // the DB re-checks on its own (the browser/engine could be bypassed)
    const early = await w.admin().rpc("create_public_booking", {
      p_workspace_id: b.ws, p_service_id: svc, p_staff_id: anna, p_resource_id: null,
      p_starts_at: "2026-10-05T09:30:00Z", p_name: "X", p_email: "x@example.test", p_phone: "", p_notes: "",
    });
    expect(early.error?.code).toBe("22023");
  });

  it("horizon: the last bookable Berlin day is today + N; the day after is refused (engine and database)", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    await w.rules(b, { maxHorizonDays: 3 });
    await w.setHours(b, null, { 0: [["09:00", "12:00"]], 1: [["09:00", "12:00"]], 2: [["09:00", "12:00"]], 3: [["09:00", "12:00"]], 4: [["09:00", "12:00"]], 5: [["09:00", "12:00"]], 6: [["09:00", "12:00"]] });
    setNow("2026-10-05T10:00:00Z"); // Mon 12:00 Berlin; horizon ends Thu 8 Oct
    expect((await w.times(b, svc, anna, D.thu)).length).toBeGreaterThan(0);
    expect(await w.times(b, svc, anna, D.fri)).toEqual([]);
    expect(await w.outcome(w.book(b, svc, anna, D.fri, "09:00"))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, anna, D.thu, "09:00"))).toBe("ok");
    const far = await w.admin().rpc("create_public_booking", {
      p_workspace_id: b.ws, p_service_id: svc, p_staff_id: anna, p_resource_id: null,
      p_starts_at: "2026-10-09T08:00:00Z", p_name: "X", p_email: "x@example.test", p_phone: "", p_notes: "",
    });
    expect(far.error?.code).toBe("22023");
  });

  it("UTC day != Berlin day: at 22:30Z on Monday it is already Tuesday in Berlin", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    setNow("2026-10-05T22:30:00Z"); // Tue 00:30 CEST
    expect(await w.times(b, svc, anna, D.mon)).toEqual([]); // yesterday in Berlin although still Monday in UTC
    expect(await w.outcome(w.book(b, svc, anna, D.mon, "10:00"))).toBe("slot_unavailable");
    expect((await w.times(b, svc, anna, D.tue))[0]).toBe("09:00");
    const r = await w.book(b, svc, anna, D.tue, "09:00");
    expect((await w.row(r.appointmentId)).starts_at.toISOString()).toBe("2026-10-06T07:00:00.000Z");
  });

  it("horizon counts Berlin days: just after Berlin midnight (still the previous UTC day) the window has already moved", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    await w.rules(b, { maxHorizonDays: 1 });
    setNow("2026-10-05T22:30:00Z"); // Berlin Tue 6 Oct
    expect((await w.times(b, svc, anna, D.wed)).length).toBeGreaterThan(0); // Tue + 1
    expect(await w.times(b, svc, anna, D.thu)).toEqual([]);
  });

  it("DST spring (2026-03-29): 09:00 Berlin is 07:00Z, conflicts are read on the Berlin wall clock", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 60);
    await w.setHours(b, null, { 0: [["08:00", "13:00"]] });
    setNow("2026-03-20T10:00:00Z");
    const r = await w.book(b, svc, anna, "2026-03-29", "09:00");
    expect((await w.row(r.appointmentId)).starts_at.toISOString()).toBe("2026-03-29T07:00:00.000Z");
    const t = await w.times(b, svc, anna, "2026-03-29");
    expect(t).toEqual([...grid("08:00", "08:00"), ...grid("10:00", "12:00")]);
    expect(await w.outcome(w.book(b, svc, anna, "2026-03-29", "09:30"))).toBe("slot_unavailable");
  });

  it("DST autumn (2026-10-25, 25-hour day): 09:00 Berlin is 08:00Z and the booked hour is blocked, the next is free", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 60);
    await w.setHours(b, null, { 0: [["08:00", "13:00"]] });
    setNow("2026-10-20T10:00:00Z");
    const r = await w.book(b, svc, anna, "2026-10-25", "09:00");
    expect((await w.row(r.appointmentId)).starts_at.toISOString()).toBe("2026-10-25T08:00:00.000Z");
    const t = await w.times(b, svc, anna, "2026-10-25");
    expect(t).toEqual([...grid("08:00", "08:00"), ...grid("10:00", "12:00")]);
    expect(await w.outcome(w.book(b, svc, anna, "2026-10-25", "09:00"))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, anna, "2026-10-25", "10:00"))).toBe("ok");
  });

  it("min notice across the autumn DST change is measured in real time", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    await w.rules(b, { minNoticeMinutes: 120 });
    await w.setHours(b, null, { 0: [["03:00", "10:00"]] });
    setNow("2026-10-24T23:30:00Z"); // Sun 25 Oct 01:30 CEST; +2h real = 01:30Z = 02:30 CET
    const t = await w.times(b, svc, anna, "2026-10-25");
    expect(t[0]).toBe("03:00");
    expect(await w.outcome(w.book(b, svc, anna, "2026-10-25", "03:00"))).toBe("ok");
  });

  it("the visitor's time zone is irrelevant (process zone Pacific/Auckland vs America/Los_Angeles)", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    const prev = process.env.TZ;
    try {
      process.env.TZ = "Pacific/Auckland";
      const a = await w.times(b, svc, anna, D.mon);
      process.env.TZ = "America/Los_Angeles";
      const c = await w.times(b, svc, anna, D.mon);
      expect(a[0]).toBe("09:00");
      expect(c).toEqual(a);
      const r = await w.book(b, svc, anna, D.mon, "09:00");
      expect((await w.row(r.appointmentId)).starts_at.toISOString()).toBe("2026-10-05T07:00:00.000Z");
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it("a workspace in another zone (America/New_York) keeps its own wall clock for hours, now and storage", async () => {
    const b = await w.biz();
    await w.q("update workspaces set timezone = 'America/New_York' where id = $1", [b.ws]);
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    const r = await w.book(b, svc, anna, D.mon, "09:00");
    expect((await w.row(r.appointmentId)).starts_at.toISOString()).toBe(wallToInstant(D.mon, "09:00", "America/New_York").toISOString());
    expect(instantToWall((await w.row(r.appointmentId)).starts_at, "America/New_York")).toEqual({ date: D.mon, time: "09:00" });
  });
});

describe("(1) guest flow: service <-> staff eligibility", () => {
  it("Manicure is never offered or bookable with Anna; 'any specialist' picks Lisa; inactive staff are excluded", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const lisa = await w.staff(b, "Lisa");
    const ghost = await w.staff(b, "Ghost", { active: false });
    const mani = await w.service(b, "Manicure", 50, { staffIds: [lisa] });
    const cut = await w.service(b, "Cut", 30);

    expect(await w.times(b, mani, anna, D.mon)).toEqual([]);
    expect(new Set((await w.slots(b, mani, null, D.mon)).map((s) => s.staffId))).toEqual(new Set([lisa]));
    expect(await w.outcome(w.book(b, mani, anna, D.mon, "10:00"))).toBe("slot_unavailable");
    // straight at the database function: refused as well
    const direct = await w.admin().rpc("create_public_booking", {
      p_workspace_id: b.ws, p_service_id: mani, p_staff_id: anna, p_resource_id: null,
      p_starts_at: wallToInstant(D.mon, "10:00", "Europe/Berlin").toISOString(), p_name: "X", p_email: "x@example.test", p_phone: "", p_notes: "",
    });
    expect(direct.error?.code).toBe("P0002");
    const any = await w.book(b, mani, null, D.mon, "10:00");
    expect(any.staffId).toBe(lisa);

    // inactive: not in the catalog, not in any slot, not bookable (engine: invalid_input; DB: staff_unavailable)
    expect(new Set((await w.slots(b, cut, null, D.mon)).map((s) => s.staffId))).toEqual(new Set([anna, lisa]));
    expect(await w.outcome(w.book(b, cut, ghost, D.mon, "10:00"))).toBe("invalid_input");
    const viaDb = await w.admin().rpc("create_public_booking", {
      p_workspace_id: b.ws, p_service_id: cut, p_staff_id: ghost, p_resource_id: null,
      p_starts_at: wallToInstant(D.mon, "11:00", "Europe/Berlin").toISOString(), p_name: "X", p_email: "x@example.test", p_phone: "", p_notes: "",
    });
    expect(viaDb.error?.code).toBe("P0002");
  });

  it("a staff member of ANOTHER business, and a deactivated service, are refused", async () => {
    const b = await w.biz();
    const other = await w.biz();
    const anna = await w.staff(b, "Anna");
    const foreign = await w.staff(other, "Foreign");
    const svc = await w.service(b, "Cut", 30);
    const gone = await w.service(b, "Gone", 30);
    await w.q("update services set active = false where id = $1", [gone]);
    expect(await w.outcome(w.book(b, svc, foreign, D.mon, "10:00"))).toBe("invalid_input");
    expect(await w.outcome(w.book(b, gone, anna, D.mon, "10:00"))).toBe("invalid_input");
  });
});

describe("(2) auto-confirm", () => {
  it("public booking: OFF -> pending, ON -> confirmed; the rule is flipped through the real settings service", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    current = createPgliteSupabaseClient(db, { kind: "user", id: b.owner });
    const session = await getSession(b.slug);

    const off = await w.book(b, svc, anna, D.mon, "09:00");
    expect(off.status).toBe("pending");
    await rulesSvc.updateBookingRules(session, { autoConfirm: true, minNoticeMinutes: 0, maxHorizonDays: 90, slotIntervalMinutes: 15, cancellationDeadlineHours: 0, rescheduleDeadlineHours: 0 });
    const on = await w.book(b, svc, anna, D.mon, "10:00");
    expect(on.status).toBe("confirmed");
    expect((await w.row(on.appointmentId)).status).toBe("confirmed");
    await rulesSvc.updateBookingRules(session, { autoConfirm: false, minNoticeMinutes: 0, maxHorizonDays: 90, slotIntervalMinutes: 15, cancellationDeadlineHours: 0, rescheduleDeadlineHours: 0 });
    expect((await w.book(b, svc, anna, D.mon, "11:00")).status).toBe("pending");
    // an earlier booking is not rewritten by the switch
    expect((await w.row(on.appointmentId)).status).toBe("confirmed");
  });

  it("the guest cannot choose the status (extra fields are ignored); the database decides", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    const r = await w.book(b, svc, anna, D.mon, "09:00", { status: "confirmed", autoConfirm: true } as never);
    expect(r.status).toBe("pending");
  });

  it("business-created appointments keep the status the business chose, regardless of the auto-confirm switch", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Cut", 30);
    const client = (await w.q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Walk-in','w@example.test') returning id", [b.ws]))[0].id;
    const repo = createSupabaseAppointmentsRepository(b.ws, async () => createPgliteSupabaseClient(db, { kind: "user", id: b.owner }));
    const base = {
      id: "x", client: "Walk-in", clientId: client, service: "Cut", serviceId: svc, staff: "Anna", staffId: anna, resourceId: null,
      durationMinutes: 30, price: 50, currency: "EUR", notes: "", visibility: "normal" as const, financialBucket: "main" as const,
      paid: false, seriesId: null, recurrence: null,
    };
    for (const auto of [false, true]) {
      await w.rules(b, { autoConfirm: auto });
      const time = auto ? "14:00" : "13:00";
      const pending = await repo.create({ ...base, date: D.mon, time, status: "pending" });
      expect(pending.status).toBe("pending");
      const confirmed = await repo.create({ ...base, date: D.tue, time, status: "confirmed" });
      expect(confirmed.status).toBe("confirmed");
    }
  });
});

describe("(3) resources: the database exclusion is the final judge", () => {
  it("2 staff + 1 room: both saw the slot free, both book at once -> exactly one wins, the other gets slot_unavailable", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const lisa = await w.staff(b, "Lisa");
    const svc = await w.service(b, "Treatment", 60, { resType: "room" });
    const room = await w.resource(b, "Room 1", "room");

    // both visitors computed the slot BEFORE either booked
    expect((await w.times(b, svc, anna, D.mon))).toContain("10:00");
    expect((await w.times(b, svc, lisa, D.mon))).toContain("10:00");

    const results = await Promise.allSettled([w.book(b, svc, anna, D.mon, "10:00"), w.book(b, svc, lisa, D.mon, "10:00")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((loser.reason as { code: string }).code).toBe("slot_unavailable");
    const rows = await w.q<{ staff_id: string; resource_id: string }>("select staff_id, resource_id from appointments where workspace_id = $1", [b.ws]);
    expect(rows).toHaveLength(1);
    expect(rows[0].resource_id).toBe(room);
    // afterwards the room is gone for everybody at that time, and overlapping times
    expect(await w.times(b, svc, lisa, D.mon)).not.toContain("10:00");
    expect(await w.times(b, svc, lisa, D.mon)).not.toContain("10:45");
    expect(await w.times(b, svc, lisa, D.mon)).toContain("11:00");
  });

  it("the same race straight at the database function: the exclusion (23P01) stops the second writer", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const lisa = await w.staff(b, "Lisa");
    const svc = await w.service(b, "Treatment", 60, { resType: "room" });
    const room = await w.resource(b, "Room 1", "room");
    const call = (staffId: string, n: number) =>
      w.admin().rpc("create_public_booking", {
        p_workspace_id: b.ws, p_service_id: svc, p_staff_id: staffId, p_resource_id: room,
        p_starts_at: wallToInstant(D.mon, "10:00", "Europe/Berlin").toISOString(),
        p_name: `G${n}`, p_email: `g${n}@example.test`, p_phone: "", p_notes: "",
      });
    const [r1, r2] = await Promise.all([call(anna, 1), call(lisa, 2)]);
    const errors = [r1.error, r2.error].filter(Boolean);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("23P01");
    expect(await w.q("select 1 from appointments where resource_id = $1", [room])).toHaveLength(1);
  });

  it("two rooms of the type: the second booking gets the other room, the third is refused", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const lisa = await w.staff(b, "Lisa");
    const tom = await w.staff(b, "Tom");
    const svc = await w.service(b, "Treatment", 60, { resType: "room" });
    const r1 = await w.resource(b, "Room 1", "room");
    const r2 = await w.resource(b, "Room 2", "room");
    const a = await w.book(b, svc, anna, D.mon, "10:00");
    const c = await w.book(b, svc, lisa, D.mon, "10:00");
    const used = [(await w.row(a.appointmentId)).resource_id, (await w.row(c.appointmentId)).resource_id].sort();
    expect(used).toEqual([r1, r2].sort());
    expect(await w.outcome(w.book(b, svc, tom, D.mon, "10:00"))).toBe("slot_unavailable");
    expect(await w.outcome(w.book(b, svc, tom, D.mon, "11:00"))).toBe("ok");
  });

  it("independent resources run in parallel: a room treatment and an equipment treatment at the same time both succeed", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const lisa = await w.staff(b, "Lisa");
    const treat = await w.service(b, "Treatment", 60, { resType: "room" });
    const laser = await w.service(b, "Laser", 60, { resType: "equipment" });
    await w.resource(b, "Room 1", "room");
    await w.resource(b, "Laser unit", "equipment");
    const results = await Promise.allSettled([w.book(b, treat, anna, D.mon, "10:00"), w.book(b, laser, lisa, D.mon, "10:00")]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("a service linked to a specific room only ever uses that room, even if another room of the type is free", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const lisa = await w.staff(b, "Lisa");
    const tom = await w.staff(b, "Tom");
    const svc = await w.service(b, "Treatment", 60, { resType: "room" });
    const other = await w.service(b, "Other room user", 60, { resType: "room" });
    const room1 = await w.resource(b, "Room 1", "room"); // not linked to svc
    const room2 = await w.resource(b, "Room 2", "room", { serviceIds: [svc] });
    const first = await w.book(b, svc, anna, D.mon, "10:00");
    expect((await w.row(first.appointmentId)).resource_id).toBe(room2);
    // Room 2 is taken; Room 1 is free but not linked to the service -> not offered, not bookable
    expect(await w.times(b, svc, lisa, D.mon)).not.toContain("10:00");
    expect(await w.outcome(w.book(b, svc, lisa, D.mon, "10:00"))).toBe("slot_unavailable");
    // the unlinked service may use Room 1 meanwhile (links restrict only the service that has them... and the type pool is shared)
    const o = await w.book(b, other, tom, D.mon, "10:00");
    expect([room1, room2]).toContain((await w.row(o.appointmentId)).resource_id);
    // the database refuses a resource outside the links on its own
    const forged = await w.admin().rpc("create_public_booking", {
      p_workspace_id: b.ws, p_service_id: svc, p_staff_id: lisa, p_resource_id: room1,
      p_starts_at: wallToInstant(D.tue, "10:00", "Europe/Berlin").toISOString(), p_name: "X", p_email: "x@example.test", p_phone: "", p_notes: "",
    });
    expect(forged.error?.code).toBe("P0002");
  });

  it("an inactive resource is never offered or accepted; a service needing a resource with none available has no slots", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Treatment", 60, { resType: "room" });
    const dead = await w.resource(b, "Old room", "room", { active: false });
    expect(await w.times(b, svc, anna, D.mon)).toEqual([]);
    const forged = await w.admin().rpc("create_public_booking", {
      p_workspace_id: b.ws, p_service_id: svc, p_staff_id: anna, p_resource_id: dead,
      p_starts_at: wallToInstant(D.mon, "10:00", "Europe/Berlin").toISOString(), p_name: "X", p_email: "x@example.test", p_phone: "", p_notes: "",
    });
    expect(forged.error?.code).toBe("P0002");
    // a resource of the wrong type is refused too
    const equip = await w.resource(b, "Laser", "equipment");
    const wrongType = await w.admin().rpc("create_public_booking", {
      p_workspace_id: b.ws, p_service_id: svc, p_staff_id: anna, p_resource_id: equip,
      p_starts_at: wallToInstant(D.mon, "10:00", "Europe/Berlin").toISOString(), p_name: "X", p_email: "x@example.test", p_phone: "", p_notes: "",
    });
    expect(wrongType.error?.code).toBe("P0002");
  });

  it("deactivating a resource keeps the old appointment readable (Business repository) and the hard delete is refused", async () => {
    const b = await w.biz();
    const anna = await w.staff(b, "Anna");
    const svc = await w.service(b, "Treatment", 60, { resType: "room" });
    const room = await w.resource(b, "Room 1", "room");
    const booked = await w.book(b, svc, anna, D.mon, "10:00");
    await w.q("update resources set active = false where id = $1", [room]);
    const repo = createSupabaseAppointmentsRepository(b.ws, async () => createPgliteSupabaseClient(db, { kind: "user", id: b.owner }));
    const seen = (await repo.list()).find((a) => a.id === booked.appointmentId)!;
    expect(seen).toMatchObject({ resourceId: room, service: "Treatment", staff: "Anna", date: D.mon, time: "10:00" });
    expect(await w.times(b, svc, anna, D.tue)).toEqual([]); // no active room left
    await expect(w.q("delete from resources where id = $1", [room])).rejects.toMatchObject({ code: "23503" });
  });
});

describe("(5) regression: demo workspaces are untouched by the new scheduling stage", () => {
  it("demo presets: availability for every demo service/staff/date is identical to the pre-0019 engine (frozen)", () => {
    const out: Record<string, string[]> = {};
    const dates = ["2026-09-21", "2026-09-22", "2026-09-25", "2026-09-26", "2026-10-05", "2026-10-06", "2026-10-10", "2026-10-11", "2026-10-12"];
    for (const ws of demoWorkspaces)
      for (const svc of ws.services)
        for (const date of dates)
          for (const staffId of [null, ...ws.staff.map((s) => s.id)]) {
            const slots = computeSlotsFor({
              serviceId: svc.id, staffId, services: ws.services, staff: ws.staff, resources: ws.resources,
              existingAppointments: ws.appointments, workingHours: demoWorkingHours, date,
            });
            out[`${ws.slug ?? ws.name}|${svc.id}|${staffId}|${date}`] = slots.map((s) => `${s.time}/${s.staffId}/${s.resourceId}`);
          }
    // Hash of the whole matrix (450 combinations), computed from a `git archive HEAD` copy of the repo BEFORE this stage.
    expect(createHash("sha256").update(JSON.stringify(out)).digest("hex")).toBe("28eb2f95ff94b38d86be0257ca0b4752ab374694af9c04e55b3f742df157f0fd");
    // and a few readable anchors
    expect(out["demo-salon|svc-haircut|null|2026-10-05"]).toHaveLength(28);
    expect(out["demo-salon|svc-haircut|null|2026-10-05"][0]).toBe("09:00/staff-elena/res-room-1");
    expect(out["demo-salon|svc-color|staff-elena|2026-10-05"]).toHaveLength(22);
    expect(out["demo-salon|svc-haircut|null|2026-10-10"]).toEqual([]); // Saturday: closed for the salon
    expect(out["demo-werkstatt|svc-oelwechsel|staff-marco|2026-10-10"].length).toBeGreaterThan(0); // Marco works Saturday (as before)
  });
});
