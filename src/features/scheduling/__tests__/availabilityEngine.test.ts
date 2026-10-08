import { describe, expect, it } from "vitest";
import { computeAvailableSlots, computeSlotsFor, uniqueSlotTimes } from "@/features/appointments/availability";
import { checkAvailability } from "@/features/workingHours/logic";
import { computeAvailableDates } from "../availableDates";
import { isWithinHorizon } from "../intervals";
import type { Appointment } from "@/features/appointments/types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { WorkingHoursProfile } from "@/features/workingHours/types";

// 2026-10-05 Mon, 06 Tue, 07 Wed, 08 Thu, 09 Fri, 10 Sat, 11 Sun
const svc = (o: Partial<ServiceDefinition> = {}): ServiceDefinition => ({
  id: "svc", name: "Cut", durationMinutes: 50, price: 50, currency: "EUR",
  bufferBeforeMinutes: 0, bufferAfterMinutes: 0, allowedStaffIds: [], requiredResourceType: null, ...o,
});
const anna: StaffMember = { id: "anna", name: "Anna", colorToken: "--c" };
const lisa: StaffMember = { id: "lisa", name: "Lisa", colorToken: "--c" };
const empty = { breaks: [], timeOff: [], blocks: [] };
const monFri = (r: { start: string; end: string } | { start: string; end: string }[]) => ({ 0: null, 1: r, 2: r, 3: r, 4: r, 5: r, 6: null });
const business = (weekly: WorkingHoursProfile["weekly"] = monFri({ start: "09:00", end: "18:00" })): WorkingHoursProfile => ({ ownerId: "business", weekly, ...empty });

function slots(o: {
  service?: ServiceDefinition; staff?: StaffMember[]; hours: WorkingHoursProfile[]; date: string;
  appts?: Appointment[]; step?: number; notBefore?: Date; resources?: ResourceDefinition[];
}) {
  const service = o.service ?? svc();
  return computeSlotsFor({
    serviceId: service.id, staffId: null, services: [service], staff: o.staff ?? [anna], resources: o.resources ?? [],
    existingAppointments: o.appts ?? [], workingHours: o.hours, date: o.date, slotIntervalMinutes: o.step, notBefore: o.notBefore,
  });
}
const times = (s: { time: string }[]) => s.map((x) => x.time);

function appt(o: Partial<Appointment>): Appointment {
  return {
    id: "a", client: "", service: "Cut", staff: "Anna", staffId: "anna", resourceId: null, date: "2026-10-06", time: "10:00",
    durationMinutes: 60, price: 0, currency: "EUR", notes: "", visibility: "normal", financialBucket: "main",
    status: "confirmed", paid: false, seriesId: null, recurrence: null, ...o,
  };
}

describe("working hours: closed day, multiple intervals", () => {
  it("offers nothing on a closed day", () => {
    expect(slots({ hours: [business()], date: "2026-10-11" })).toEqual([]);
  });

  it("09-13 + 14-18: a 50 min service never spans the lunch gap", () => {
    const t = times(slots({ hours: [business(monFri([{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }]))], date: "2026-10-05" }));
    expect(t).toContain("12:00"); // 12:00-12:50
    expect(t).not.toContain("12:15"); // would end 13:05
    expect(t.filter((x) => x > "12:00" && x < "14:00")).toEqual([]);
    expect(t).toContain("14:00");
    expect(t[t.length - 1]).toBe("17:00"); // 17:00-17:50; 17:15 ends 18:05
    expect(checkAvailability("anna", "2026-10-05", "12:30", 50, [business(monFri([{ start: "09:00", end: "13:00" }, { start: "14:00", end: "18:00" }]))]).available).toBe(false);
  });

  it("derives the window from the hours (no hard-coded 08-20)", () => {
    const t = times(slots({ hours: [business(monFri({ start: "06:00", end: "22:00" }))], date: "2026-10-05" }));
    expect(t[0]).toBe("06:00");
    expect(t[t.length - 1]).toBe("21:00");
  });
});

describe("business INTERSECT staff; inherit vs custom", () => {
  const anaCustom: WorkingHoursProfile = {
    ownerId: "anna", mode: "custom", ...empty,
    weekly: { 0: null, 1: { start: "09:00", end: "16:00" }, 2: { start: "09:00", end: "16:00" }, 3: { start: "09:00", end: "16:00" }, 4: null, 5: null, 6: null },
  };
  it("custom narrows: Mon-Wed 09-16, Thursday none, last 50-min start", () => {
    const hours = [business(), anaCustom];
    expect(slots({ hours, date: "2026-10-08" })).toEqual([]);
    const wed = times(slots({ hours, date: "2026-10-07" }));
    expect(wed[0]).toBe("09:00");
    expect(wed[wed.length - 1]).toBe("15:00"); // 15:15 would end 16:05
    expect(times(slots({ hours, date: "2026-10-07", step: 10 })).pop()).toBe("15:10"); // 15:10 + 50 = 16:00
  });
  it("custom can never open a day the business is closed", () => {
    const sat: WorkingHoursProfile = { ...anaCustom, weekly: { ...anaCustom.weekly, 6: { start: "10:00", end: "14:00" } } };
    expect(slots({ hours: [business(), sat], date: "2026-10-10" })).toEqual([]);
  });
  it("custom cannot widen the business hours", () => {
    const wide: WorkingHoursProfile = { ...anaCustom, weekly: { ...anaCustom.weekly, 1: { start: "07:00", end: "20:00" } } };
    const t = times(slots({ hours: [business(), wide], date: "2026-10-05" }));
    expect(t[0]).toBe("09:00");
    expect(t[t.length - 1]).toBe("17:00");
  });
  it("inherit and no own profile = business hours", () => {
    const inh: WorkingHoursProfile = { ownerId: "anna", mode: "inherit", weekly: {}, ...empty };
    expect(times(slots({ hours: [business(), inh], date: "2026-10-08" }))[0]).toBe("09:00");
    expect(times(slots({ hours: [business()], date: "2026-10-08" }))[0]).toBe("09:00");
  });
});

describe("time off", () => {
  it("a business closure beats any staff profile (also inherit and custom)", () => {
    const closed: WorkingHoursProfile = { ...business(), timeOff: [{ startDate: "2026-10-07", endDate: "2026-10-07" }] };
    const custom: WorkingHoursProfile = { ownerId: "anna", mode: "custom", weekly: monFri({ start: "09:00", end: "18:00" }), ...empty };
    expect(slots({ hours: [closed, custom], date: "2026-10-07" })).toEqual([]);
    expect(slots({ hours: [closed], date: "2026-10-07" })).toEqual([]);
    expect(checkAvailability("anna", "2026-10-07", "10:00", 50, [closed, custom]).reason).toBe("timeOff");
    expect(slots({ hours: [closed], date: "2026-10-08" }).length).toBeGreaterThan(0);
  });
  it("full-day staff time off excludes only that person", () => {
    const off: WorkingHoursProfile = { ownerId: "anna", mode: "inherit", weekly: {}, breaks: [], blocks: [], timeOff: [{ startDate: "2026-10-06", endDate: "2026-10-07" }] };
    const r = slots({ hours: [business(), off], staff: [anna, lisa], date: "2026-10-06" });
    expect(new Set(r.map((s) => s.staffId))).toEqual(new Set(["lisa"]));
  });
  it("partial-day time off blocks only the overlapping starts", () => {
    const part: WorkingHoursProfile = { ownerId: "anna", mode: "inherit", weekly: {}, breaks: [], timeOff: [], blocks: [{ date: "2026-10-06", start: "10:00", end: "12:00" }] };
    const t = times(slots({ hours: [business(), part], date: "2026-10-06" }));
    expect(t).toContain("09:00"); // 09:00-09:50
    expect(t).not.toContain("09:15"); // overlaps 10:00
    expect(t).not.toContain("11:45");
    expect(t).toContain("12:00");
    expect(checkAvailability("anna", "2026-10-06", "10:30", 50, [business(), part]).reason).toBe("blocked");
  });
  it("a business partial closure applies to everyone", () => {
    const biz: WorkingHoursProfile = { ...business(), blocks: [{ date: "2026-10-06", start: "12:00", end: "14:00" }] };
    expect(times(slots({ hours: [biz], date: "2026-10-06", staff: [anna, lisa] })).filter((x) => x > "11:10" && x < "14:00")).toEqual([]);
  });
});

describe("slot interval grid", () => {
  const hours = [business(monFri({ start: "09:00", end: "12:00" }))];
  it("15 / 30 / 60 minute grids with a 50 min service", () => {
    expect(times(slots({ hours, date: "2026-10-05", step: 15 })).slice(0, 3)).toEqual(["09:00", "09:15", "09:30"]);
    expect(times(slots({ hours, date: "2026-10-05", step: 30 }))).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
    expect(times(slots({ hours, date: "2026-10-05", step: 60 }))).toEqual(["09:00", "10:00", "11:00"]);
  });
  it("start times sit on the clock grid even if the interval starts off-grid", () => {
    const odd = [business(monFri({ start: "09:10", end: "12:00" }))];
    expect(times(slots({ hours: odd, date: "2026-10-05", step: 30 }))[0]).toBe("09:30");
  });
});

describe("conflicts, buffers, notice", () => {
  const hours = [business()];
  it("buffers participate: an existing 10:00-11:00 + 15 min after buffer pushes the next start to 11:15", () => {
    const buffered = svc({ bufferAfterMinutes: 15 });
    const t = times(slots({ service: buffered, hours, date: "2026-10-06", appts: [appt({ serviceId: "svc", time: "10:00" })] }));
    expect(t).not.toContain("11:00");
    expect(t).toContain("11:15");
    // candidate's own buffer too: 08:xx not available; 09:00-09:50 + 15 = 10:05 > 10:00 conflict
    expect(t).not.toContain("09:00");
  });
  it("notBefore (min notice) excludes earlier starts, boundary included", () => {
    const nb = new Date(2026, 9, 6, 10, 0, 0);
    const t = times(slots({ hours, date: "2026-10-06", notBefore: nb }));
    expect(t[0]).toBe("10:00");
    const later = times(slots({ hours, date: "2026-10-06", notBefore: new Date(2026, 9, 6, 10, 1, 0) }));
    expect(later[0]).toBe("10:15");
    expect(times(slots({ hours, date: "2026-10-06", notBefore: new Date(2026, 9, 7, 0, 0, 0) }))).toEqual([]);
  });
  it("horizon boundaries", () => {
    expect(isWithinHorizon("2026-10-04", "2026-10-04", 90)).toBe(true);
    expect(isWithinHorizon("2026-10-03", "2026-10-04", 90)).toBe(false);
    expect(isWithinHorizon("2027-01-02", "2026-10-04", 90)).toBe(true); // +90
    expect(isWithinHorizon("2027-01-03", "2026-10-04", 90)).toBe(false);
  });
});

describe("eligibility, inactive, any specialist", () => {
  const hours = [business()];
  it("a service restricted to Lisa never offers Anna", () => {
    const manicure = svc({ id: "m", name: "Manicure", allowedStaffIds: ["lisa"] });
    const r = computeSlotsFor({ serviceId: "m", staffId: null, services: [manicure], staff: [anna, lisa], resources: [], existingAppointments: [], workingHours: hours, date: "2026-10-06" });
    expect(new Set(r.map((s) => s.staffId))).toEqual(new Set(["lisa"]));
    const forAnna = computeSlotsFor({ serviceId: "m", staffId: "anna", services: [manicure], staff: [anna, lisa], resources: [], existingAppointments: [], workingHours: hours, date: "2026-10-06" });
    expect(forAnna).toEqual([]);
  });
  it("inactive staff and resources are never offered", () => {
    const off = { ...anna, active: false };
    const r = slots({ hours, staff: [off, lisa], date: "2026-10-06" });
    expect(new Set(r.map((s) => s.staffId))).toEqual(new Set(["lisa"]));
    expect(slots({ hours, staff: [off], date: "2026-10-06" })).toEqual([]);
    const needs = svc({ requiredResourceType: "room" });
    expect(slots({ service: needs, hours, date: "2026-10-06", resources: [{ id: "r1", name: "R", type: "room", active: false }] })).toEqual([]);
  });
  it("any specialist collapses to one entry per time", () => {
    const all = slots({ hours, staff: [anna, lisa], date: "2026-10-06" });
    const uniq = uniqueSlotTimes(all);
    expect(all.length).toBe(uniq.length * 2);
    expect(new Set(times(uniq)).size).toBe(uniq.length);
  });
});

describe("resources", () => {
  const hours = [business()];
  const needs = svc({ requiredResourceType: "room" });
  const room = (id: string): ResourceDefinition => ({ id, name: id, type: "room" });
  const booked = appt({ staffId: "anna", resourceId: "r1", time: "10:00", durationMinutes: 50 });
  const run = (resources: ResourceDefinition[], service = needs) =>
    computeSlotsFor({ serviceId: service.id, staffId: null, services: [service], staff: [anna, lisa], resources, existingAppointments: [booked], workingHours: hours, date: "2026-10-06" });

  it("2 staff + 1 resource: the second parallel booking is impossible", () => {
    const r = run([room("r1")]);
    expect(r.filter((s) => s.time === "10:00")).toEqual([]);
    expect(r.some((s) => s.time === "11:00")).toBe(true);
  });
  it("two independent resources allow a parallel booking on the free one", () => {
    const r = run([room("r1"), room("r2")]);
    const at10 = r.filter((s) => s.time === "10:00");
    expect(at10.map((s) => [s.staffId, s.resourceId])).toEqual([["lisa", "r2"]]);
  });
  it("linked resources win over all of the type; links to inactive ones leave nothing", () => {
    const linked = svc({ requiredResourceType: "room", resourceIds: ["r2"] });
    expect(new Set(run([room("r1"), room("r2")], linked).map((s) => s.resourceId))).toEqual(new Set(["r2"]));
    expect(run([room("r1"), { ...room("r2"), active: false }], linked)).toEqual([]);
  });
});

describe("available dates", () => {
  it("lists only days with real slots (closed weekend, closure, horizon)", () => {
    const closure: WorkingHoursProfile = { ...business(), timeOff: [{ startDate: "2026-10-07", endDate: "2026-10-07" }] };
    const dates = computeAvailableDates({
      serviceId: "svc", staffId: null, services: [svc()], staff: [anna], resources: [], existingAppointments: [], workingHours: [closure],
      fromDate: "2026-10-05", days: 8, today: "2026-10-05", maxHorizonDays: 4,
    });
    expect(dates).toEqual(["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09"]);
  });
});

describe("computeAvailableSlots direct", () => {
  it("default step is 15", () => {
    const r = computeAvailableSlots({ service: svc({ durationMinutes: 30 }), eligibleStaff: [anna], candidateResources: [], existingAppointments: [], allServices: [svc()], workingHours: [business(monFri({ start: "09:00", end: "10:00" }))], date: "2026-10-05" });
    expect(times(r)).toEqual(["09:00", "09:15", "09:30"]);
  });
});
