import { describe, expect, it } from "vitest";
import { workingHoursFromRows } from "../workingHoursMapper";
import { busyRangesToAppointments } from "../busyMapper";
import { checkAvailability } from "@/features/workingHours/logic";
import {
  appointmentFromRow,
  instantsFor,
  maskedAppointmentFromRow,
  statusFromDb,
  statusToDb,
  visibilityFromDb,
  visibilityToDb,
  type AppointmentLookups,
} from "@/server/repository/appointmentsMapper";
import type { AppointmentStatus, Visibility } from "@/features/appointments/types";

describe("working hours rows -> engine profiles", () => {
  it("builds a business default and per-staff profiles keyed by the stable staff id", () => {
    const profiles = workingHoursFromRows([
      { staff_id: null, weekday: 1, start_time: "09:00:00", end_time: "18:00:00", is_day_off: false },
      { staff_id: null, weekday: 0, start_time: null, end_time: null, is_day_off: true },
      { staff_id: "s1", weekday: 1, start_time: "10:00:00", end_time: "14:00:00", is_day_off: false },
    ]);
    expect(profiles.map((p) => p.ownerId).sort()).toEqual(["business", "s1"]);
    expect(profiles.find((p) => p.ownerId === "business")!.weekly).toEqual({ 1: { start: "09:00", end: "18:00" }, 0: null });
    expect(checkAvailability("s1", "2026-10-05", "10:00", 60, profiles).available).toBe(true); // Monday, own hours
    expect(checkAvailability("s1", "2026-10-05", "09:00", 60, profiles).available).toBe(false); // before own start
    expect(checkAvailability("other", "2026-10-05", "09:00", 60, profiles).available).toBe(true); // falls back to business
  });

  it("DEFAULT-DENY: a workspace with no hours at all is closed, not 'always open'", () => {
    const profiles = workingHoursFromRows([]);
    expect(checkAvailability("anyone", "2026-10-05", "10:00", 30, profiles).available).toBe(false);
  });
});

describe("busy ranges -> engine appointments", () => {
  const staff = [{ id: "s1", name: "You", colorToken: "--c" }];

  it("reads the range in the business's wall clock", () => {
    // 07:00Z-07:30Z in Berlin summer = 09:00-09:30
    const [a] = busyRangesToAppointments([{ staff_id: "s1", resource_id: null, busy_from: "2026-07-15T07:00:00Z", busy_until: "2026-07-15T07:30:00Z" }], "Europe/Berlin", staff);
    expect(a).toMatchObject({ date: "2026-07-15", time: "09:00", durationMinutes: 30, staffId: "s1", staff: "You" });
  });

  it("splits a range that crosses midnight into one entry per day", () => {
    const parts = busyRangesToAppointments([{ staff_id: "s1", resource_id: null, busy_from: "2026-07-15T21:30:00Z", busy_until: "2026-07-15T22:30:00Z" }], "Europe/Berlin", staff); // 23:30–00:30
    expect(parts.map((p) => [p.date, p.time, p.durationMinutes])).toEqual([["2026-07-15", "23:30", 30], ["2026-07-16", "00:00", 30]]);
  });
});

describe("appointment row mapping", () => {
  const lookups: AppointmentLookups = {
    clients: new Map([["c1", "Anna"]]), services: new Map([["sv1", "Haircut"]]), staff: new Map([["st1", "Elena"]]),
    bucketKinds: new Map([["b1", "private"]]), series: new Map(),
  };
  const row = {
    id: "a1", workspace_id: "w", client_id: "c1", service_id: "sv1", staff_id: "st1", resource_id: null,
    starts_at: "2026-10-26T08:00:00Z", ends_at: "2026-10-26T08:45:00Z", timezone: "Europe/Berlin", status: "checked_in",
    visibility: "owner_only", financial_bucket_id: "b1", client_notes: "n", price: "55.50", currency: "EUR", paid: true, series_id: null,
  };

  it("maps ids to names, snake_case enums to the domain, and reads wall-clock in the row's zone", () => {
    const a = appointmentFromRow(row, lookups);
    expect(a).toMatchObject({
      client: "Anna", clientId: "c1", service: "Haircut", serviceId: "sv1", staff: "Elena", staffId: "st1",
      date: "2026-10-26", time: "09:00", durationMinutes: 45, price: 55.5, status: "checkedIn", visibility: "ownerOnly",
      financialBucket: "private", financialBucketId: "b1", paid: true, notes: "n",
    });
  });

  it("Visibility and Financial Account are separate fields (all combinations representable)", () => {
    for (const v of ["normal", "private", "ownerOnly", "custom"] as Visibility[]) {
      expect(visibilityFromDb(visibilityToDb(v))).toBe(v);
    }
    const noBucketAccess = appointmentFromRow(row, { ...lookups, bucketKinds: new Map() });
    expect(noBucketAccess.visibility).toBe("ownerOnly");
    expect(noBucketAccess.financialBucketId).toBeUndefined(); // an account the viewer may not use is not revealed
    expect(noBucketAccess.financialBucket).toBe("main");
  });

  it("every status survives the round trip", () => {
    const all: AppointmentStatus[] = ["pending", "confirmed", "checkedIn", "inProgress", "completed", "cancelled", "noShow", "rescheduled"];
    for (const s of all) expect(statusFromDb(statusToDb(s))).toBe(s);
  });

  it("a masked row exposes only time, person and visibility", () => {
    const m = maskedAppointmentFromRow(
      { id: "a1", staff_id: "st1", resource_id: "r1", starts_at: row.starts_at, ends_at: row.ends_at, timezone: row.timezone, status: "confirmed", visibility: "private" },
      lookups,
    );
    expect(m).toMatchObject({ client: "", service: "", notes: "", price: 0, visibility: "private", staff: "Elena", time: "09:00", resourceId: "r1" });
    expect(m.clientId).toBeUndefined();
  });

  it("wall-clock -> instants uses the business zone, including across daylight saving", () => {
    expect(instantsFor("2026-10-26", "09:00", 45, "Europe/Berlin")).toEqual({ startsAt: "2026-10-26T08:00:00.000Z", endsAt: "2026-10-26T08:45:00.000Z" });
    expect(instantsFor("2026-10-24", "09:00", 30, "Europe/Berlin").startsAt).toBe("2026-10-24T07:00:00.000Z"); // still summer time
  });
});
