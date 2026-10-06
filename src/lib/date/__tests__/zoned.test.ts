import { describe, expect, it } from "vitest";
import { utcToZonedParts, weekdayOfDate, zonedDateTimeToUtc } from "../zoned";

describe("zonedDateTimeToUtc", () => {
  it("converts Berlin winter time (UTC+1)", () => {
    expect(zonedDateTimeToUtc("2026-01-15", "10:00", "Europe/Berlin").toISOString()).toBe(
      "2026-01-15T09:00:00.000Z",
    );
  });

  it("converts Berlin summer time (UTC+2)", () => {
    expect(zonedDateTimeToUtc("2026-07-15", "10:00", "Europe/Berlin").toISOString()).toBe(
      "2026-07-15T08:00:00.000Z",
    );
  });

  it("handles the day of the spring DST change", () => {
    // 2026-03-29: clocks go 02:00 -> 03:00 in Berlin.
    expect(zonedDateTimeToUtc("2026-03-29", "01:30", "Europe/Berlin").toISOString()).toBe(
      "2026-03-29T00:30:00.000Z",
    );
    expect(zonedDateTimeToUtc("2026-03-29", "09:00", "Europe/Berlin").toISOString()).toBe(
      "2026-03-29T07:00:00.000Z",
    );
  });

  it("handles the day of the autumn DST change", () => {
    // 2026-10-25: clocks go 03:00 -> 02:00 in Berlin.
    expect(zonedDateTimeToUtc("2026-10-25", "09:00", "Europe/Berlin").toISOString()).toBe(
      "2026-10-25T08:00:00.000Z",
    );
  });

  it("works for zones east and west of UTC", () => {
    expect(zonedDateTimeToUtc("2026-07-15", "12:00", "America/New_York").toISOString()).toBe(
      "2026-07-15T16:00:00.000Z",
    );
    expect(zonedDateTimeToUtc("2026-07-15", "12:00", "Europe/Kyiv").toISOString()).toBe(
      "2026-07-15T09:00:00.000Z",
    );
  });
});

describe("utcToZonedParts", () => {
  it("round-trips with zonedDateTimeToUtc", () => {
    for (const [date, time] of [
      ["2026-01-15", "09:00"],
      ["2026-07-15", "17:45"],
      ["2026-12-31", "23:30"],
      ["2026-03-29", "09:00"],
    ]) {
      const instant = zonedDateTimeToUtc(date, time, "Europe/Berlin");
      expect(utcToZonedParts(instant, "Europe/Berlin")).toEqual({ date, time });
    }
  });

  it("accepts an ISO string and rolls the date over midnight", () => {
    expect(utcToZonedParts("2026-07-15T22:30:00.000Z", "Europe/Berlin")).toEqual({
      date: "2026-07-16",
      time: "00:30",
    });
  });
});

describe("weekdayOfDate", () => {
  it("returns 0 for Sunday and 1 for Monday", () => {
    expect(weekdayOfDate("2026-09-27")).toBe(0);
    expect(weekdayOfDate("2026-09-28")).toBe(1);
    expect(weekdayOfDate("2026-10-03")).toBe(6);
  });
});
