import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { workingHoursFromRows } from "../workingHoursMapper";
import { checkAvailability } from "@/features/workingHours/logic";
import {
  computeAvailableDatesForCatalog,
  computeSlots,
  normalizePublicCatalog,
  parseBookingRules,
  type PublicCatalog,
} from "../publicBooking.service";
import { uniqueSlotTimes } from "@/features/appointments/availability";

const wh = (staff_id: string | null, weekday: number, s: string, e: string) => ({ staff_id, weekday, start_time: s + ":00", end_time: e + ":00", is_day_off: false });
const off = (staff_id: string | null, weekday: number) => ({ staff_id, weekday, start_time: null, end_time: null, is_day_off: true });

describe("workingHoursFromRows (0019)", () => {
  it("multi-interval rows become lists; day-off rows close the day", () => {
    const p = workingHoursFromRows([wh(null, 1, "09:00", "13:00"), wh(null, 1, "14:00", "18:00"), off(null, 0)]);
    const biz = p.find((x) => x.ownerId === "business")!;
    expect(biz.weekly[1]).toEqual([{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }]);
    expect(biz.weekly[0]).toBeNull();
    expect(checkAvailability("x", "2026-10-05", "12:45", 30, p).available).toBe(false);
    expect(checkAvailability("x", "2026-10-05", "14:00", 30, p).available).toBe(true);
    expect(checkAvailability("x", "2026-10-11", "10:00", 30, p).reason).toBe("dayOff");
  });
  it("business closure + staff time off: full day -> timeOff, partial -> blocks", () => {
    const p = workingHoursFromRows(
      [wh(null, 1, "09:00", "18:00"), wh(null, 2, "09:00", "18:00")],
      [
        { staff_id: null, start_date: "2026-10-05", end_date: "2026-10-05" },
        { staff_id: "s1", start_date: "2026-10-06", end_date: "2026-10-06", start_time: "10:00:00", end_time: "12:00:00" },
      ],
      { s1: "inherit" },
    );
    expect(checkAvailability("s1", "2026-10-05", "10:00", 30, p).reason).toBe("timeOff");
    expect(checkAvailability("s1", "2026-10-06", "11:00", 30, p).reason).toBe("blocked");
    expect(checkAvailability("s1", "2026-10-06", "12:00", 30, p).available).toBe(true);
    expect(checkAvailability("s2", "2026-10-06", "11:00", 30, p).available).toBe(true); // other staff unaffected
  });
  it("inherit ignores own rows; custom intersects; custom without rows = closed; no mode + rows = custom", () => {
    const rows = [wh(null, 1, "09:00", "18:00"), wh("a", 1, "10:00", "12:00"), wh("b", 1, "10:00", "12:00"), wh("d", 1, "07:00", "20:00")];
    const p = workingHoursFromRows(rows, [], { a: "inherit", b: "custom", c: "custom" });
    expect(checkAvailability("a", "2026-10-05", "09:00", 60, p).available).toBe(true);
    expect(checkAvailability("b", "2026-10-05", "09:00", 60, p).available).toBe(false);
    expect(checkAvailability("b", "2026-10-05", "10:00", 60, p).available).toBe(true);
    expect(checkAvailability("c", "2026-10-05", "10:00", 60, p).available).toBe(false);
    expect(checkAvailability("d", "2026-10-05", "08:00", 60, p).available).toBe(false); // widened -> clipped
  });
  it("default-deny: no business rows = closed", () => {
    expect(checkAvailability("x", "2026-10-05", "10:00", 30, workingHoursFromRows([], [], {})).available).toBe(false);
  });
});

const raw = (over: Record<string, unknown> = {}) =>
  ({
    workspace: { id: "w", slug: "s", name: "S", timezone: "Europe/Berlin", autoConfirm: true },
    services: [
      { id: "svc", name: "Cut", durationMinutes: 50, price: 1, currency: "EUR", bufferBeforeMinutes: 0, bufferAfterMinutes: 0, requiredResourceType: null, allowedStaffIds: [] },
      { id: "man", name: "Manicure", durationMinutes: 50, price: 1, currency: "EUR", bufferBeforeMinutes: 0, bufferAfterMinutes: 0, requiredResourceType: null, allowedStaffIds: ["lisa"] },
    ],
    staff: [{ id: "anna", name: "Anna", title: "Stylist" }, { id: "lisa", name: "Lisa" }],
    resources: [],
    workingHours: [1, 2, 3, 4, 5].map((d) => ({ staffId: null, weekday: d, start: "09:00", end: "18:00", isDayOff: false })),
    ...over,
  }) as never;

describe("public catalog parsing", () => {
  it("a pre-0019 payload gets safe defaults and does not crash", () => {
    const c = normalizePublicCatalog(raw());
    expect(c.rules).toMatchObject({ minNoticeMinutes: 0, maxHorizonDays: 90, slotIntervalMinutes: 15, autoConfirm: true });
    expect(c.timeOff).toEqual([]);
    expect(c.staffModes).toEqual({});
    expect(c.services[0].resourceIds).toEqual([]);
  });
  it("parses rules, time off, modes, titles; rejects out-of-range rules", () => {
    const c = normalizePublicCatalog(
      raw({
        rules: { minNoticeMinutes: 120, maxHorizonDays: 30, slotIntervalMinutes: 30 },
        timeOff: [{ staffId: null, startDate: "2026-10-07", endDate: "2026-10-07", startTime: null, endTime: null }],
        staffModes: [{ staffId: "anna", mode: "custom" }, { staffId: "lisa", mode: "bogus" }],
      }),
    );
    expect(c.rules).toMatchObject({ minNoticeMinutes: 120, maxHorizonDays: 30, slotIntervalMinutes: 30 });
    expect(c.timeOff).toHaveLength(1);
    expect(c.staffModes).toEqual({ anna: "custom" });
    expect(c.staff[0]).toMatchObject({ title: "Stylist", scheduleMode: "custom" });
    expect(parseBookingRules({ maxHorizonDays: 999, slotIntervalMinutes: 7, minNoticeMinutes: -1 }, false)).toMatchObject({ maxHorizonDays: 90, slotIntervalMinutes: 15, minNoticeMinutes: 0 });
  });
});

function fakeAdmin(busy: { staff_id: string | null; resource_id: string | null; busy_from: string; busy_until: string }[] = []) {
  return { rpc: async (name: string) => ({ data: name === "get_public_busy" ? busy : null, error: null }) } as unknown as SupabaseClient;
}
const catalog = (over: Record<string, unknown> = {}): PublicCatalog => normalizePublicCatalog(raw(over));
const at = (iso: string) => ({ now: () => new Date(iso) });
const T = (s: { time: string }[]) => s.map((x) => x.time);

describe("computeSlots (server) in the workspace time zone", () => {
  it("'today' is the Berlin day, not the UTC day", async () => {
    // 2026-10-05 22:30Z = 2026-10-06 00:30 in Berlin (CEST)
    const deps = { admin: fakeAdmin(), ...at("2026-10-05T22:30:00Z") };
    expect(await computeSlots(deps, catalog(), "svc", null, "2026-10-05")).toEqual([]); // yesterday in Berlin
    expect((await computeSlots(deps, catalog(), "svc", "anna", "2026-10-06")).length).toBeGreaterThan(0);
  });
  it("applies min notice, horizon and the slot interval from the catalog rules", async () => {
    const c = catalog({ rules: { minNoticeMinutes: 180, maxHorizonDays: 2, slotIntervalMinutes: 30 } });
    // 08:00Z = 10:00 Berlin Tue 2026-10-06; +3h = 13:00
    const deps = { admin: fakeAdmin(), ...at("2026-10-06T08:00:00Z") };
    const t = T(await computeSlots(deps, c, "svc", "anna", "2026-10-06"));
    expect(t[0]).toBe("13:00");
    expect(t.every((x) => x.endsWith(":00") || x.endsWith(":30"))).toBe(true);
    expect(await computeSlots(deps, c, "svc", "anna", "2026-10-09")).toEqual([]); // beyond +2 days
    expect((await computeSlots(deps, c, "svc", "anna", "2026-10-08")).length).toBeGreaterThan(0);
  });
  it("min notice stays correct across the October DST change (instant arithmetic)", async () => {
    // 2026-10-24 23:30Z = Sun 25 Oct 01:30 CEST; +2h of real time = 02:30 CEST?? -> 01:30Z = 02:30 CET
    const c = catalog({ rules: { minNoticeMinutes: 120 }, workingHours: [0].map(() => ({ staffId: null, weekday: 0, start: "00:00", end: "10:00", isDayOff: false })) });
    const deps = { admin: fakeAdmin(), ...at("2026-10-24T23:30:00Z") };
    const t = T(await computeSlots(deps, c, "svc", "anna", "2026-10-25"));
    expect(t[0]).toBe("02:30"); // 01:30Z in Berlin (CET) is 02:30
  });
  it("busy ranges are read in Berlin wall clock around DST changes", async () => {
    // 2026-03-29 (CEST starts 02:00->03:00): 08:00Z = 10:00 CEST
    const spring = catalog({ workingHours: [0].map(() => ({ staffId: null, weekday: 0, start: "09:00", end: "13:00", isDayOff: false })) });
    const dSpring = { admin: fakeAdmin([{ staff_id: "anna", resource_id: null, busy_from: "2026-03-29T08:00:00Z", busy_until: "2026-03-29T09:00:00Z" }]), ...at("2026-03-20T10:00:00Z") };
    const t1 = T(await computeSlots(dSpring, spring, "svc", "anna", "2026-03-29"));
    expect(t1).not.toContain("10:00");
    expect(t1).toContain("09:00");
    expect(t1).toContain("11:00");
    // 2026-10-25 (CET starts): 08:00Z = 09:00 CET
    const autumn = catalog({ workingHours: [0].map(() => ({ staffId: null, weekday: 0, start: "09:00", end: "13:00", isDayOff: false })) });
    const dAut = { admin: fakeAdmin([{ staff_id: "anna", resource_id: null, busy_from: "2026-10-25T08:00:00Z", busy_until: "2026-10-25T09:00:00Z" }]), ...at("2026-10-20T10:00:00Z") };
    const t2 = T(await computeSlots(dAut, autumn, "svc", "anna", "2026-10-25"));
    expect(t2).not.toContain("09:00");
    expect(t2).toContain("10:00");
  });
  it("is independent of the visitor's time zone (process zone does not matter)", async () => {
    const deps = { admin: fakeAdmin(), ...at("2026-10-05T10:00:00Z") };
    const a = T(await computeSlots(deps, catalog(), "svc", "anna", "2026-10-06"));
    const prev = process.env.TZ;
    process.env.TZ = "Pacific/Auckland";
    const b = T(await computeSlots(deps, catalog(), "svc", "anna", "2026-10-06"));
    process.env.TZ = prev;
    expect(b).toEqual(a);
  });
  it("service eligibility and any-specialist collapse", async () => {
    const deps = { admin: fakeAdmin(), ...at("2026-10-05T10:00:00Z") };
    const man = await computeSlots(deps, catalog(), "man", null, "2026-10-06");
    expect(new Set(man.map((s) => s.staffId))).toEqual(new Set(["lisa"]));
    const all = await computeSlots(deps, catalog(), "svc", null, "2026-10-06");
    expect(uniqueSlotTimes(all).length * 2).toBe(all.length);
  });
});

describe("available dates (server)", () => {
  it("only days with slots; business closure and weekend excluded; one busy fetch", async () => {
    let calls = 0;
    const admin = { rpc: async () => ((calls += 1), { data: [], error: null }) } as unknown as SupabaseClient;
    const c = catalog({ timeOff: [{ staffId: null, startDate: "2026-10-07", endDate: "2026-10-07", startTime: null, endTime: null }], rules: { maxHorizonDays: 7 } });
    const dates = await computeAvailableDatesForCatalog({ admin, ...at("2026-10-05T10:00:00Z") }, c, "svc", null, "2026-10-05", 14);
    expect(dates).toEqual(["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09", "2026-10-12"]);
    expect(calls).toBe(1);
  });
});
