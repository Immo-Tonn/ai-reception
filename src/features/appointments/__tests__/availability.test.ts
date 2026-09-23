import { describe, expect, it } from "vitest";
import { computeAvailableSlots } from "../availability";
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

const elena: StaffMember = { id: "staff-elena", name: "Elena", colorToken: "--color-accent-blue" };

const businessHours: WorkingHoursProfile = {
  ownerId: "Elena",
  weekly: {
    0: null,
    1: { start: "09:00", end: "11:00" },
    2: { start: "09:00", end: "18:00" },
    3: { start: "09:00", end: "18:00" },
    4: { start: "09:00", end: "18:00" },
    5: { start: "09:00", end: "18:00" },
    6: null,
  },
  breaks: [],
  timeOff: [],
  blocks: [],
};

describe("computeAvailableSlots — booking availability", () => {
  it("only returns slots inside the staff member's working hours", () => {
    // 2026-09-21 is a Monday (09:00-11:00 window in `businessHours`).
    const slots = computeAvailableSlots({
      service: haircut,
      eligibleStaff: [elena],
      candidateResources: [],
      existingAppointments: [],
      allServices: [haircut],
      workingHours: [businessHours],
      date: "2026-09-21",
    });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.time >= "09:00" && s.time <= "10:00")).toBe(true);
  });

  it("excludes a slot already taken by an existing appointment", () => {
    const existing: Appointment[] = [
      {
        id: "a1",
        client: "Anna Müller",
        service: "Haircut",
        staff: "Elena",
        resourceId: null,
        date: "2026-09-22",
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
      },
    ];

    const slots = computeAvailableSlots({
      service: haircut,
      eligibleStaff: [elena],
      candidateResources: [],
      existingAppointments: existing,
      allServices: [haircut],
      workingHours: [businessHours],
      date: "2026-09-22",
    });

    expect(slots.some((s) => s.time === "09:00")).toBe(false);
    expect(slots.some((s) => s.time === "10:00")).toBe(true);
  });

  it("returns no slots on the staff member's day off", () => {
    const slots = computeAvailableSlots({
      service: haircut,
      eligibleStaff: [elena],
      candidateResources: [],
      existingAppointments: [],
      allServices: [haircut],
      workingHours: [businessHours],
      date: "2026-09-20", // Sunday
    });
    expect(slots).toHaveLength(0);
  });
});
