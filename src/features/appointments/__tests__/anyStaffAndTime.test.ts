import { describe, expect, it } from "vitest";
import { computeAvailableSlots, pickSlot, uniqueSlotTimes } from "../availability";
import { findConflicts } from "../conflicts";
import { backfillAppointmentIds, belongsToClient, isSameStaff } from "../identity";
import type { Appointment } from "../types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { WorkingHoursProfile } from "@/features/workingHours/types";

const haircut: ServiceDefinition = {
  id: "svc-haircut",
  name: "Haircut",
  durationMinutes: 60,
  price: 55,
  currency: "EUR",
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  allowedStaffIds: [],
  requiredResourceType: null,
};
const elena: StaffMember = { id: "staff-elena", name: "Elena", colorToken: "--c" };
const marco: StaffMember = { id: "staff-marco", name: "Marco", colorToken: "--c" };

const week = {
  0: null,
  1: { start: "09:00", end: "12:00" },
  2: { start: "09:00", end: "12:00" },
  3: { start: "09:00", end: "12:00" },
  4: { start: "09:00", end: "12:00" },
  5: { start: "09:00", end: "12:00" },
  6: null,
};
const hours: WorkingHoursProfile[] = [
  { ownerId: "business", weekly: week, breaks: [], timeOff: [], blocks: [] },
];

function appt(overrides: Partial<Appointment>): Appointment {
  return {
    id: "a",
    client: "Anna",
    service: "Haircut",
    staff: "Elena",
    resourceId: null,
    date: "2026-09-22", // Tuesday
    time: "09:00",
    durationMinutes: 60,
    price: 55,
    currency: "EUR",
    notes: "",
    visibility: "normal",
    financialBucket: "main",
    status: "confirmed",
    paid: false,
    seriesId: null,
    recurrence: null,
    ...overrides,
  };
}

const base = {
  service: haircut,
  candidateResources: [],
  allServices: [haircut],
  workingHours: hours,
  date: "2026-09-22",
};

describe("any specialist → unique times", () => {
  it("the engine returns one slot per specialist, uniqueSlotTimes shows each time once", () => {
    const slots = computeAvailableSlots({ ...base, eligibleStaff: [elena, marco], existingAppointments: [] });
    const times = slots.map((s) => s.time);
    expect(times.length).toBe(new Set(times).size * 2);

    const unique = uniqueSlotTimes(slots);
    expect(unique.map((s) => s.time)).toEqual([...new Set(times)]);
  });

  it("keeps a time bookable when only one specialist is free, and assigns that specialist", () => {
    const slots = computeAvailableSlots({
      ...base,
      eligibleStaff: [elena, marco],
      existingAppointments: [appt({ staff: "Elena", staffId: "staff-elena", time: "09:00" })],
    });
    expect(uniqueSlotTimes(slots).some((s) => s.time === "09:00")).toBe(true);
    expect(pickSlot(slots, "09:00", null)?.staffId).toBe("staff-marco");
  });

  it("a specific specialist is never swapped for another", () => {
    const slots = computeAvailableSlots({
      ...base,
      eligibleStaff: [elena, marco],
      existingAppointments: [appt({ staff: "Elena", staffId: "staff-elena", time: "09:00" })],
    });
    expect(pickSlot(slots, "09:00", "staff-elena")).toBeUndefined();
    expect(pickSlot(slots, "10:00", "staff-elena")?.staffName).toBe("Elena");
  });
});

describe("today → past slots excluded", () => {
  it("drops slots starting before `notBefore` (injected clock, nothing hard-coded)", () => {
    const notBefore = new Date("2026-09-22T10:44:00");
    const slots = computeAvailableSlots({
      ...base,
      eligibleStaff: [elena],
      existingAppointments: [],
      notBefore,
    });
    // 10:44 → first bookable start is 10:45 (15-min grid); 09:00–10:30 are gone.
    expect(slots.map((s) => s.time)).toEqual(["10:45", "11:00"]);
  });

  it("without notBefore nothing is filtered (lead-time policy is the caller's input)", () => {
    const slots = computeAvailableSlots({ ...base, eligibleStaff: [elena], existingAppointments: [] });
    expect(slots[0].time).toBe("09:00");
  });

  it("a future date is unaffected by notBefore", () => {
    const slots = computeAvailableSlots({
      ...base,
      eligibleStaff: [elena],
      existingAppointments: [],
      notBefore: new Date("2026-09-21T23:00:00"),
    });
    expect(slots[0].time).toBe("09:00");
  });
});

describe("staff conflicts use stable ids", () => {
  const candidate = {
    id: "new",
    staff: "Alex",
    staffId: "staff-b",
    resourceId: null,
    date: "2026-09-22",
    time: "09:00",
    durationMinutes: 60,
    service: "Haircut",
    serviceId: "svc-haircut",
  };

  it("two different people with the same display name do not conflict", () => {
    const existing = [appt({ staff: "Alex", staffId: "staff-a" })];
    expect(findConflicts(candidate, existing, [haircut]).hasConflict).toBe(false);
  });

  it("the same staffId conflicts even if the display name changed", () => {
    const existing = [appt({ staff: "Alexander", staffId: "staff-b" })];
    expect(findConflicts(candidate, existing, [haircut]).hasConflict).toBe(true);
  });

  it("legacy records without ids still conflict by name (backward compatible)", () => {
    const existing = [appt({ staff: "Alex" })];
    expect(isSameStaff(existing[0], candidate)).toBe(true);
    expect(findConflicts(candidate, existing, [haircut]).hasConflict).toBe(true);
  });

  it("buffers are taken from the service resolved by id, not by name", () => {
    const withBuffer: ServiceDefinition = { ...haircut, bufferAfterMinutes: 30 };
    const existing = [appt({ staff: "Alex", staffId: "staff-b", service: "Old name", serviceId: "svc-haircut" })];
    const nextSlot = { ...candidate, time: "10:15" };
    expect(findConflicts(nextSlot, existing, [withBuffer]).hasConflict).toBe(true);
  });
});

describe("clientId association", () => {
  it("links by clientId so same-named clients are not mixed up", () => {
    const a = { id: "c1", name: "Anna Müller" };
    const b = { id: "c2", name: "Anna Müller" };
    const mine = appt({ client: "Anna Müller", clientId: "c1" });
    expect(belongsToClient(mine, a)).toBe(true);
    expect(belongsToClient(mine, b)).toBe(false);
  });

  it("falls back to name only for legacy appointments with no clientId", () => {
    expect(belongsToClient(appt({ client: "Anna Müller" }), { id: "c9", name: "Anna Müller" })).toBe(true);
  });

  it("backfills staffId/serviceId on legacy appointments without touching stored data", () => {
    const legacy = appt({});
    const result = backfillAppointmentIds(legacy, { staff: [elena], services: [haircut] });
    expect(result.staffId).toBe("staff-elena");
    expect(result.serviceId).toBe("svc-haircut");
    expect(legacy.staffId).toBeUndefined();
  });
});
