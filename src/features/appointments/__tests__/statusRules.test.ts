import { describe, expect, it } from "vitest";
import { canTransition, checkInitialStatus, checkStatusTransition, hasStarted, wallNow } from "../statusRules";
import type { AppointmentStatus } from "../types";

const now = { date: "2026-10-15", time: "12:00" };
const future = (status: AppointmentStatus) => ({ date: "2026-10-20", time: "10:00", status });
const laterToday = (status: AppointmentStatus) => ({ date: "2026-10-15", time: "16:00", status });
const past = (status: AppointmentStatus) => ({ date: "2026-10-14", time: "10:00", status });

describe("statusRules", () => {
  it("hasStarted uses the wall clock (start minute counts as started)", () => {
    expect(hasStarted({ date: "2026-10-15", time: "12:00" }, now)).toBe(true);
    expect(hasStarted({ date: "2026-10-15", time: "12:01" }, now)).toBe(false);
    expect(hasStarted({ date: "2026-10-14", time: "23:59" }, now)).toBe(true);
  });

  it("future: no Completed / No-show; cancel and confirm are fine", () => {
    expect(checkStatusTransition(future("confirmed"), "completed", now)).toEqual({ ok: false, reason: "not_started" });
    expect(checkStatusTransition(future("pending"), "noShow", now)).toEqual({ ok: false, reason: "not_started" });
    expect(canTransition(future("confirmed"), "checkedIn", now)).toBe(false);
    expect(canTransition(future("pending"), "confirmed", now)).toBe(true);
    expect(canTransition(future("confirmed"), "cancelled", now)).toBe(true);
    expect(canTransition(future("cancelled"), "confirmed", now)).toBe(true);
  });

  it("later today: check-in allowed early, outcome not yet", () => {
    expect(canTransition(laterToday("confirmed"), "checkedIn", now)).toBe(true);
    expect(canTransition(laterToday("checkedIn"), "completed", now)).toBe(true); // the client is here
    expect(canTransition(laterToday("confirmed"), "noShow", now)).toBe(false);
  });

  it("past: outcomes and corrections, no cancel, no reviving a cancelled one", () => {
    expect(canTransition(past("confirmed"), "noShow", now)).toBe(true);
    expect(canTransition(past("confirmed"), "completed", now)).toBe(true);
    expect(canTransition(past("noShow"), "completed", now)).toBe(true);
    expect(canTransition(past("completed"), "noShow", now)).toBe(true);
    expect(canTransition(past("completed"), "confirmed", now)).toBe(true);
    expect(checkStatusTransition(past("confirmed"), "cancelled", now)).toEqual({ ok: false, reason: "already_happened" });
    expect(checkStatusTransition(past("cancelled"), "confirmed", now)).toEqual({ ok: false, reason: "already_happened" });
    expect(canTransition(past("checkedIn"), "noShow", now)).toBe(false); // a checked-in client did come
    expect(canTransition(past("cancelled"), "completed", now)).toBe(false);
  });

  it("the legacy 'rescheduled' value can never be chosen; a legacy row behaves like confirmed", () => {
    expect(checkStatusTransition(future("confirmed"), "rescheduled", now)).toEqual({ ok: false, reason: "legacy" });
    expect(canTransition(future("rescheduled"), "cancelled", now)).toBe(true);
    expect(checkInitialStatus({ date: "2026-10-20", time: "10:00" }, "rescheduled", now)).toBe(false);
  });

  it("initial status: entering a past visit afterwards is allowed, a future outcome is not", () => {
    expect(checkInitialStatus({ date: "2026-10-14", time: "10:00" }, "completed", now)).toBe(true);
    expect(checkInitialStatus({ date: "2026-10-20", time: "10:00" }, "completed", now)).toBe(false);
    expect(checkInitialStatus({ date: "2026-10-20", time: "10:00" }, "noShow", now)).toBe(false);
    expect(checkInitialStatus({ date: "2026-10-20", time: "10:00" }, "pending", now)).toBe(true);
  });

  it("wallNow converts to the workspace time zone", () => {
    const instant = new Date("2026-10-15T22:30:00Z");
    expect(wallNow("Europe/Berlin", instant)).toEqual({ date: "2026-10-16", time: "00:30" });
    expect(wallNow("America/New_York", instant)).toEqual({ date: "2026-10-15", time: "18:30" });
  });
});
