import { describe, expect, it } from "vitest";
import { findConflicts } from "../conflicts";
import type { Appointment } from "../types";
import type { ServiceDefinition } from "@/features/services/types";

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "a1",
    client: "Anna Müller",
    service: "Haircut",
    staff: "Elena",
    resourceId: null,
    date: "2026-09-22",
    time: "09:00",
    durationMinutes: 45,
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

const haircut: ServiceDefinition = {
  id: "svc-haircut",
  name: "Haircut",
  durationMinutes: 45,
  price: 55,
  currency: "EUR",
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 10,
  allowedStaffIds: [],
  requiredResourceType: null,
};

describe("findConflicts — staff double-booking", () => {
  it("flags two appointments for the same staff that overlap", () => {
    const existing = [makeAppointment({ id: "a1", time: "09:00", durationMinutes: 45 })];
    const result = findConflicts(
      { id: "a2", staff: "Elena", resourceId: null, date: "2026-09-22", time: "09:20", durationMinutes: 30, service: "Haircut" },
      existing,
      [haircut],
    );
    expect(result.hasConflict).toBe(true);
    expect(result.staffConflict?.id).toBe("a1");
  });

  it("does not flag two non-overlapping appointments for the same staff", () => {
    const existing = [makeAppointment({ id: "a1", time: "09:00", durationMinutes: 30 })];
    const result = findConflicts(
      { id: "a2", staff: "Elena", resourceId: null, date: "2026-09-22", time: "10:00", durationMinutes: 30, service: "Haircut" },
      existing,
      [haircut],
    );
    expect(result.hasConflict).toBe(false);
  });

  it("does not flag overlapping appointments for different staff", () => {
    const existing = [makeAppointment({ id: "a1", staff: "Elena", time: "09:00", durationMinutes: 45 })];
    const result = findConflicts(
      { id: "a2", staff: "Marco", resourceId: null, date: "2026-09-22", time: "09:00", durationMinutes: 45, service: "Haircut" },
      existing,
      [haircut],
    );
    expect(result.hasConflict).toBe(false);
  });

  it("ignores cancelled appointments when checking for conflicts", () => {
    const existing = [makeAppointment({ id: "a1", time: "09:00", durationMinutes: 45, status: "cancelled" })];
    const result = findConflicts(
      { id: "a2", staff: "Elena", resourceId: null, date: "2026-09-22", time: "09:00", durationMinutes: 45, service: "Haircut" },
      existing,
      [haircut],
    );
    expect(result.hasConflict).toBe(false);
  });
});

describe("findConflicts — service buffers", () => {
  it("flags a booking that starts inside another appointment's buffer-after window", () => {
    // Haircut 09:00-09:45 + 10min buffer-after => occupied until 09:55.
    const existing = [makeAppointment({ id: "a1", time: "09:00", durationMinutes: 45 })];
    const result = findConflicts(
      { id: "a2", staff: "Elena", resourceId: null, date: "2026-09-22", time: "09:50", durationMinutes: 20, service: "Haircut" },
      existing,
      [haircut],
    );
    expect(result.hasConflict).toBe(true);
  });

  it("allows a booking that starts right after the buffer window ends", () => {
    const existing = [makeAppointment({ id: "a1", time: "09:00", durationMinutes: 45 })];
    const result = findConflicts(
      { id: "a2", staff: "Elena", resourceId: null, date: "2026-09-22", time: "09:55", durationMinutes: 20, service: "Haircut" },
      existing,
      [haircut],
    );
    expect(result.hasConflict).toBe(false);
  });
});

describe("findConflicts — resource double-booking", () => {
  it("flags two appointments using the same resource at overlapping times", () => {
    const existing = [
      makeAppointment({ id: "a1", staff: "Elena", resourceId: "res-room-1", time: "09:00", durationMinutes: 45 }),
    ];
    const result = findConflicts(
      { id: "a2", staff: "Marco", resourceId: "res-room-1", date: "2026-09-22", time: "09:15", durationMinutes: 30, service: "Haircut" },
      existing,
      [haircut],
    );
    expect(result.hasConflict).toBe(true);
    expect(result.resourceConflict?.id).toBe("a1");
  });

  it("does not flag the same resource used at non-overlapping times", () => {
    const existing = [
      makeAppointment({ id: "a1", staff: "Elena", resourceId: "res-room-1", time: "09:00", durationMinutes: 30 }),
    ];
    const result = findConflicts(
      { id: "a2", staff: "Marco", resourceId: "res-room-1", date: "2026-09-22", time: "10:00", durationMinutes: 30, service: "Haircut" },
      existing,
      [haircut],
    );
    expect(result.hasConflict).toBe(false);
  });
});
