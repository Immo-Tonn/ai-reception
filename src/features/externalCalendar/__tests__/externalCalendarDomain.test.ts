import { describe, expect, it } from "vitest";
import { checkSlotAvailable, computeSlotsFor, uniqueSlotTimes } from "@/features/appointments/availability";
import type { Appointment } from "@/features/appointments/types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import { busyRangesToAppointments } from "@/server/booking/busyMapper";
import { BusyIntervalOverflowError, MAX_BUSY_INTERVALS, normalizeBusyIntervals, parseStoredBusy } from "../normalize";
import { EXTERNAL_BUSY_POLICY, cacheWindow, isCacheFresh, isCacheUsableWhenStale, requestChunks } from "../policy";
import { findExternalConflicts } from "../conflicts";

const svc = (over: Partial<ServiceDefinition> = {}) =>
  ({ id: "svc", name: "Cut", durationMinutes: 60, price: 40, currency: "EUR", allowedStaffIds: [], ...over }) as ServiceDefinition;
const person = (id: string, name: string) => ({ id, name, active: true }) as StaffMember;
const staff = ["s1", "s2", "s3", "s4", "s5"].map((id, i) => person(id, `Master ${i + 1}`));

/** Google busy 14:00-15:00 for master 1 on 2026-10-05, as the engine sees it. */
const googleBusy = (staffId = "s1", from = "14:00", to = "15:00", date = "2026-10-05") =>
  busyRangesToAppointments(
    [{ staff_id: staffId, resource_id: null, busy_from: `${date}T${from}:00Z`, busy_until: `${date}T${to}:00Z` }],
    "UTC",
    staff,
    "external",
  );

const run = (over: Partial<Parameters<typeof computeSlotsFor>[0]> = {}) =>
  computeSlotsFor({
    serviceId: "svc",
    staffId: null,
    services: [svc()],
    staff,
    resources: [],
    existingAppointments: [],
    workingHours: [],
    date: "2026-10-05",
    slotIntervalMinutes: 60,
    ...over,
  });

describe("availability engine with external busy time (the salon example)", () => {
  it("master 1 busy 14:00-15:00 in Google: not bookable then; the other four are", () => {
    const slots = run({ externalBusy: googleBusy() });
    const at14 = slots.filter((s) => s.time === "14:00").map((s) => s.staffId);
    expect(at14).toEqual(["s2", "s3", "s4", "s5"]);
    // Master 1 is still free before and after the event.
    expect(slots.some((s) => s.staffId === "s1" && s.time === "13:00")).toBe(true);
    expect(slots.some((s) => s.staffId === "s1" && s.time === "15:00")).toBe(true);
    // "Any specialist" still offers 14:00 (via someone else).
    expect(uniqueSlotTimes(slots).some((s) => s.time === "14:00")).toBe(true);
  });

  it("choosing master 1 explicitly hides 14:00 (and 13:30 for a 60-minute service overlapping it)", () => {
    const slots = run({ staffId: "s1", externalBusy: googleBusy(), slotIntervalMinutes: 30 });
    const times = slots.map((s) => s.time);
    expect(times).not.toContain("14:00");
    expect(times).not.toContain("13:30");
    expect(times).not.toContain("14:30");
    expect(times).toContain("13:00");
    expect(times).toContain("15:00");
  });

  it("the service's own buffers still apply against external busy time", () => {
    const slots = run({ staffId: "s1", services: [svc({ bufferAfterMinutes: 15 })], externalBusy: googleBusy(), slotIntervalMinutes: 15 });
    // 13:00-14:00 + 15 min cleanup would run into the 14:00 event.
    expect(slots.map((s) => s.time)).not.toContain("13:00");
    expect(slots.map((s) => s.time)).toContain("12:45");
  });

  it("an unconfirmed person gets no slots at all; nobody else is affected", () => {
    const slots = run({ externalUnavailableStaffIds: ["s1"] });
    expect(slots.some((s) => s.staffId === "s1")).toBe(false);
    expect(new Set(slots.map((s) => s.staffId))).toEqual(new Set(["s2", "s3", "s4", "s5"]));
  });

  it("external busy never blocks a resource, only the person", () => {
    const room = { id: "r1", name: "Room", type: "room", active: true } as never;
    const slots = run({ services: [svc({ requiredResourceType: "room" })], resources: [room], externalBusy: googleBusy() });
    expect(slots.filter((s) => s.time === "14:00").map((s) => s.resourceId)).toEqual(["r1", "r1", "r1", "r1"]);
  });

  it("checkSlotAvailable (business side) reports the specific reasons", () => {
    const base = { service: svc(), staff: person("s1", "Master 1"), resourceId: null, date: "2026-10-05", existingAppointments: [], allServices: [svc()], workingHours: [] };
    expect(checkSlotAvailable({ ...base, time: "14:00", externalBusy: googleBusy() })).toEqual({ available: false, reason: "externalBusy" });
    expect(checkSlotAvailable({ ...base, time: "15:00", externalBusy: googleBusy() })).toEqual({ available: true });
    expect(checkSlotAvailable({ ...base, time: "10:00", externalUnavailableStaffIds: ["s1"] })).toEqual({ available: false, reason: "externalUnconfirmed" });
    expect(checkSlotAvailable({ ...base, staff: person("s2", "Master 2"), time: "14:00", externalBusy: googleBusy() })).toEqual({ available: true });
  });

  it("a multi-day external block (holiday) is split per day and covers every day", () => {
    const busy = busyRangesToAppointments(
      [{ staff_id: "s1", resource_id: null, busy_from: "2026-10-05T00:00:00Z", busy_until: "2026-10-19T00:00:00Z" }],
      "UTC",
      staff,
      "external",
    );
    expect(busy).toHaveLength(14);
    expect(run({ staffId: "s1", date: "2026-10-12", externalBusy: busy })).toEqual([]);
  });

  it("time zone: a Google event at 12:00Z is 14:00 in Berlin (summer time)", () => {
    const busy = busyRangesToAppointments(
      [{ staff_id: "s1", resource_id: null, busy_from: "2026-07-06T12:00:00Z", busy_until: "2026-07-06T13:00:00Z" }],
      "Europe/Berlin",
      staff,
      "external",
    );
    expect(busy[0]).toMatchObject({ date: "2026-07-06", time: "14:00", durationMinutes: 60, staffId: "s1", resourceId: null });
  });
});

describe("normalizeBusyIntervals", () => {
  const from = new Date("2026-10-05T00:00:00Z");
  const until = new Date("2026-10-06T00:00:00Z");

  it("merges overlapping/adjacent blocks, clips to the window and keeps only start/end", () => {
    const out = normalizeBusyIntervals(
      [
        { start: "2026-10-05T10:00:00Z", end: "2026-10-05T11:00:00Z", summary: "Doctor" } as never,
        { start: "2026-10-05T10:30:00Z", end: "2026-10-05T12:00:00Z" },
        { start: "2026-10-05T12:00:00Z", end: "2026-10-05T12:30:00Z" },
        { start: "2026-10-04T23:00:00Z", end: "2026-10-05T01:00:00Z" },
        { start: "2026-10-05T23:30:00Z", end: "2026-10-06T02:00:00Z" },
      ],
      from,
      until,
    );
    expect(out).toEqual([
      { start: "2026-10-05T00:00:00.000Z", end: "2026-10-05T01:00:00.000Z" },
      { start: "2026-10-05T10:00:00.000Z", end: "2026-10-05T12:30:00.000Z" },
      { start: "2026-10-05T23:30:00.000Z", end: "2026-10-06T00:00:00.000Z" },
    ]);
    expect(JSON.stringify(out)).not.toContain("Doctor");
  });

  it("drops unparsable or empty blocks", () => {
    expect(normalizeBusyIntervals([{ start: "x", end: "y" }, { start: "2026-10-05T10:00:00Z", end: "2026-10-05T10:00:00Z" }, {}], from, until)).toEqual([]);
  });

  it("refuses an absurd number of blocks instead of silently truncating", () => {
    const many = Array.from({ length: MAX_BUSY_INTERVALS + 1 }, (_, i) => ({
      start: new Date(from.getTime() + i * 1000).toISOString(),
      end: new Date(from.getTime() + i * 1000 + 500).toISOString(),
    }));
    expect(() => normalizeBusyIntervals(many, from, until)).toThrow(BusyIntervalOverflowError);
  });

  it("parseStoredBusy rejects malformed cache values", () => {
    expect(parseStoredBusy([{ start: "2026-10-05T10:00:00Z", end: "2026-10-05T11:00:00Z" }])).toHaveLength(1);
    expect(parseStoredBusy({})).toBeNull();
    expect(parseStoredBusy([{ start: "nope", end: 1 }])).toBeNull();
  });
});

describe("freshness policy", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const w = cacheWindow(now);
  const state = (ageMs: number) => ({ fetchedAt: new Date(now.getTime() - ageMs), windowFrom: w.from, windowUntil: w.until });
  const from = new Date("2026-10-06T00:00:00Z");
  const until = new Date("2026-10-07T00:00:00Z");

  it("browse trusts 5 minutes, commit only 60 seconds", () => {
    expect(isCacheFresh(state(4 * 60_000), now, "browse", from, until)).toBe(true);
    expect(isCacheFresh(state(6 * 60_000), now, "browse", from, until)).toBe(false);
    expect(isCacheFresh(state(30_000), now, "commit", from, until)).toBe(true);
    expect(isCacheFresh(state(90_000), now, "commit", from, until)).toBe(false);
  });

  it("a stale cache is a fallback only up to 15 minutes, and only if it covers the request", () => {
    expect(isCacheUsableWhenStale(state(14 * 60_000), now, from, until)).toBe(true);
    expect(isCacheUsableWhenStale(state(16 * 60_000), now, from, until)).toBe(false);
    expect(isCacheUsableWhenStale({ fetchedAt: null, windowFrom: null, windowUntil: null }, now, from, until)).toBe(false);
    const farFuture = new Date(now.getTime() + 400 * 86_400_000);
    expect(isCacheUsableWhenStale(state(0), now, from, farFuture)).toBe(false);
  });

  it("splits the provider window into chunks of at most 60 days", () => {
    const chunks = requestChunks(w.from, w.until);
    expect(chunks.length).toBe(Math.ceil((EXTERNAL_BUSY_POLICY.windowFutureDays + 1) / EXTERNAL_BUSY_POLICY.maxRequestDays));
    expect(chunks[0].from).toEqual(w.from);
    expect(chunks[chunks.length - 1].until).toEqual(w.until);
    for (const c of chunks) expect(c.until.getTime() - c.from.getTime()).toBeLessThanOrEqual(60 * 86_400_000);
  });
});

describe("findExternalConflicts", () => {
  it("lists active ServiceOS appointments that overlap their person's external busy time (never cancelled ones)", () => {
    const appt = (id: string, time: string, status: Appointment["status"] = "confirmed", staffId = "s1") =>
      ({ id, staffId, staff: "Master 1", date: "2026-10-05", time, durationMinutes: 60, service: "Cut", status, resourceId: null }) as Appointment;
    const conflicts = findExternalConflicts(
      [appt("a", "13:30"), appt("b", "15:00"), appt("c", "14:00", "cancelled"), appt("d", "14:00", "confirmed", "s2")],
      googleBusy(),
      [svc()],
    );
    expect(conflicts.map((c) => c.appointmentId)).toEqual(["a"]);
  });
});
