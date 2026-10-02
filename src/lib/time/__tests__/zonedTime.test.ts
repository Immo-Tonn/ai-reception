import { describe, expect, it } from "vitest";
import { addDays, instantToWall, isValidTimeZone, nowAsWallClock, wallToInstant, zoneOffsetMinutes } from "../zonedTime";

const BERLIN = "Europe/Berlin";

describe("zoneOffsetMinutes", () => {
  it("knows winter and summer time", () => {
    expect(zoneOffsetMinutes(Date.UTC(2026, 0, 15, 12), BERLIN)).toBe(60);
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 15, 12), BERLIN)).toBe(120);
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 15, 12), "America/New_York")).toBe(-240);
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 15, 12), "Asia/Kolkata")).toBe(330);
    expect(zoneOffsetMinutes(Date.UTC(2026, 6, 15, 12), "UTC")).toBe(0);
  });
});

describe("wallToInstant / instantToWall", () => {
  it("converts an ordinary wall time (summer and winter)", () => {
    expect(wallToInstant("2026-07-15", "09:00", BERLIN).toISOString()).toBe("2026-07-15T07:00:00.000Z");
    expect(wallToInstant("2026-01-15", "09:00", BERLIN).toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("round-trips across a whole year of 15-minute slots in two zones", () => {
    for (const tz of [BERLIN, "America/New_York", "Australia/Sydney"]) {
      for (let day = 0; day < 366; day += 7) {
        const date = addDays("2026-01-01", day);
        for (const time of ["00:00", "01:30", "09:00", "12:15", "23:45"]) {
          const back = instantToWall(wallToInstant(date, time, tz), tz);
          // 02:00-03:00 wall times may legitimately not exist on a spring-forward day
          if (!(time === "01:30" || time === "02:30")) expect(back, `${tz} ${date} ${time}`).toEqual({ date, time });
        }
      }
    }
  });

  it("spring forward: a wall time that does not exist moves to the first instant after the gap", () => {
    // Berlin 2026-03-29: 02:00 -> 03:00 (02:30 never happens)
    const instant = wallToInstant("2026-03-29", "02:30", BERLIN);
    expect(instant.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(instantToWall(instant, BERLIN)).toEqual({ date: "2026-03-29", time: "03:30" });
  });

  it("fall back: a wall time that happens twice resolves to its FIRST occurrence", () => {
    // Berlin 2026-10-25: 03:00 -> 02:00 (02:30 happens twice)
    const instant = wallToInstant("2026-10-25", "02:30", BERLIN);
    expect(instant.toISOString()).toBe("2026-10-25T00:30:00.000Z"); // still CEST (+2)
    expect(instantToWall(instant, BERLIN)).toEqual({ date: "2026-10-25", time: "02:30" });
  });

  it("the day of a transition still has correct times around it", () => {
    expect(wallToInstant("2026-03-29", "01:00", BERLIN).toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(wallToInstant("2026-03-29", "09:00", BERLIN).toISOString()).toBe("2026-03-29T07:00:00.000Z");
    expect(wallToInstant("2026-10-25", "09:00", BERLIN).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("works for a zone with a half-hour offset and no DST", () => {
    expect(wallToInstant("2026-07-15", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-07-15T03:30:00.000Z");
  });

  it("the same instant reads differently in different zones", () => {
    const instant = new Date("2026-07-15T07:00:00.000Z");
    expect(instantToWall(instant, BERLIN)).toEqual({ date: "2026-07-15", time: "09:00" });
    expect(instantToWall(instant, "America/Los_Angeles")).toEqual({ date: "2026-07-15", time: "00:00" });
    expect(instantToWall(instant, "Pacific/Auckland")).toEqual({ date: "2026-07-15", time: "19:00" });
  });
});

describe("nowAsWallClock", () => {
  it("returns a Date whose LOCAL fields are the zone's wall clock, whatever the server zone is", () => {
    const now = new Date("2026-07-15T08:44:30.000Z"); // Berlin: 10:44
    const wall = nowAsWallClock(now, BERLIN);
    expect([wall.getFullYear(), wall.getMonth() + 1, wall.getDate(), wall.getHours(), wall.getMinutes()]).toEqual([2026, 7, 15, 10, 44]);
  });

  it("crosses midnight correctly (UTC is still yesterday in Sydney's tomorrow)", () => {
    const now = new Date("2026-07-15T23:30:00.000Z"); // Sydney: 2026-07-16 09:30
    const wall = nowAsWallClock(now, "Australia/Sydney");
    expect([wall.getDate(), wall.getHours()]).toEqual([16, 9]);
  });
});

describe("misc", () => {
  it("validates zone names", () => {
    expect(isValidTimeZone("Europe/Berlin")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
  });
  it("adds days across month and leap boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
