import { describe, expect, it } from "vitest";
import { buildDateStrip, zoneCityLabel } from "../dateStrip";
import { splitBookings } from "@/features/publicBooking/bookingTime";

const BERLIN = "Europe/Berlin";

describe("buildDateStrip (business timezone)", () => {
  it("UTC day != Berlin day: 22:30Z on Oct 3 is Oct 4 in Berlin", () => {
    const now = new Date("2026-10-03T22:30:00Z");
    const strip = buildDateStrip(now, BERLIN);
    expect(strip[0]).toBe("2026-10-04");
    expect(strip).toHaveLength(14);
    expect(strip[13]).toBe("2026-10-17");
  });

  it("midnight boundary", () => {
    expect(buildDateStrip(new Date("2026-10-03T21:59:59Z"), BERLIN)[0]).toBe("2026-10-03");
    expect(buildDateStrip(new Date("2026-10-03T22:00:00Z"), BERLIN)[0]).toBe("2026-10-04");
  });

  it("DST end 2026-10-25 (25h day) and DST start 2026-03-29 (23h day)", () => {
    const end = buildDateStrip(new Date("2026-10-24T12:00:00Z"), BERLIN, { maxDaysAhead: 3 });
    expect(end).toEqual(["2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
    // 23:30Z on Oct 24 is 01:30 CEST Oct 25; 23:30Z Oct 25 is 00:30 CET Oct 26.
    expect(buildDateStrip(new Date("2026-10-24T23:30:00Z"), BERLIN)[0]).toBe("2026-10-25");
    expect(buildDateStrip(new Date("2026-10-25T22:59:00Z"), BERLIN)[0]).toBe("2026-10-25");
    expect(buildDateStrip(new Date("2026-10-25T23:00:00Z"), BERLIN)[0]).toBe("2026-10-26");

    const start = buildDateStrip(new Date("2026-03-28T12:00:00Z"), BERLIN, { maxDaysAhead: 3 });
    expect(start).toEqual(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    expect(buildDateStrip(new Date("2026-03-28T23:00:00Z"), BERLIN)[0]).toBe("2026-03-29");
    expect(buildDateStrip(new Date("2026-03-29T21:59:00Z"), BERLIN)[0]).toBe("2026-03-29");
    expect(buildDateStrip(new Date("2026-03-29T22:00:00Z"), BERLIN)[0]).toBe("2026-03-30");
  });

  it("does not depend on the visitor zone (the business zone is the argument)", () => {
    const now = new Date("2026-10-03T22:30:00Z");
    // New York is still Oct 3 18:30, Tokyo is already Oct 4 07:30 — Berlin day wins.
    expect(buildDateStrip(now, BERLIN)[0]).toBe("2026-10-04");
    expect(buildDateStrip(now, "America/New_York")[0]).toBe("2026-10-03");
    expect(buildDateStrip(now, "Asia/Tokyo")[0]).toBe("2026-10-04");
  });

  it("min/max days ahead window", () => {
    const now = new Date("2026-10-03T22:30:00Z");
    expect(buildDateStrip(now, BERLIN, { minDaysAhead: 1, maxDaysAhead: 3 })).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
    ]);
    expect(buildDateStrip(now, BERLIN, { minDaysAhead: 5, maxDaysAhead: 4 })).toEqual([]);
    expect(buildDateStrip(now, BERLIN, { maxDaysAhead: 29 })).toHaveLength(30);
  });

  it("no timezone (demo) keeps browser-local date", () => {
    const now = new Date(2026, 9, 3, 23, 30); // local
    expect(buildDateStrip(now, null)[0]).toBe("2026-10-03");
  });

  it("zoneCityLabel", () => {
    expect(zoneCityLabel("Europe/Berlin")).toBe("Berlin");
    expect(zoneCityLabel("America/Los_Angeles")).toBe("Los Angeles");
  });
});

describe("My Bookings upcoming/past split", () => {
  const mk = (date: string, timezone?: string | null, status = "confirmed") => ({
    date,
    time: "10:00",
    timezone,
    status,
  });

  it("uses the business zone saved with the booking", () => {
    const now = new Date("2026-10-03T22:30:00Z"); // Berlin: Oct 4; New York: Oct 3
    const { upcoming, past } = splitBookings(
      [mk("2026-10-03", BERLIN), mk("2026-10-04", BERLIN), mk("2026-10-03", "America/New_York")],
      now,
    );
    expect(past.map((b) => b.timezone)).toEqual([BERLIN]);
    expect(upcoming).toHaveLength(2);
  });

  it("legacy records without timezone use the browser-local day", () => {
    const now = new Date(2026, 9, 4, 0, 30); // local Oct 4
    const { upcoming, past } = splitBookings([mk("2026-10-03"), mk("2026-10-04", null)], now);
    expect(past.map((b) => b.date)).toEqual(["2026-10-03"]);
    expect(upcoming.map((b) => b.date)).toEqual(["2026-10-04"]);
  });

  it("inactive statuses are past, upcoming sorted ascending", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    const { upcoming, past } = splitBookings(
      [mk("2026-10-09", BERLIN), mk("2026-10-05", BERLIN), mk("2026-10-06", BERLIN, "cancelled")],
      now,
    );
    expect(upcoming.map((b) => b.date)).toEqual(["2026-10-05", "2026-10-09"]);
    expect(past.map((b) => b.date)).toEqual(["2026-10-06"]);
  });
});
