import { describe, expect, it } from "vitest";
import { localIsoDate } from "../localIsoDate";

describe("localIsoDate", () => {
  it("formats a date using local calendar fields, not UTC", () => {
    // A Date constructed from explicit local y/m/d components — its
    // .toISOString() would drift by a day in some timezones near
    // midnight (the bug this helper fixes); local getters never do.
    const d = new Date(2026, 8, 22); // September 22 2026, local midnight
    expect(localIsoDate(d)).toBe("2026-09-22");
  });

  it("pads single-digit months and days", () => {
    const d = new Date(2026, 0, 5); // January 5 2026
    expect(localIsoDate(d)).toBe("2026-01-05");
  });

  it("never depends on the UTC calendar day, only local fields", () => {
    // Late evening local time — a naive toISOString() call on this Date
    // would very plausibly report the next UTC day depending on the
    // runner's timezone. localIsoDate must still read the LOCAL date.
    const d = new Date(2026, 8, 22, 23, 30);
    expect(localIsoDate(d)).toBe("2026-09-22");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(22);
  });
});
