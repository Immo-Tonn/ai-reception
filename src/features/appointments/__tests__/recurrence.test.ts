import { describe, expect, it } from "vitest";
import { expandRecurrenceDates } from "../recurrence";

describe("expandRecurrenceDates", () => {
  it("expands a weekly recurrence into the correct dates", () => {
    const dates = expandRecurrenceDates("2026-09-01", { frequency: "weekly", count: 3 });
    expect(dates).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });

  it("expands a biweekly recurrence", () => {
    const dates = expandRecurrenceDates("2026-09-01", { frequency: "biweekly", count: 3 });
    expect(dates).toEqual(["2026-09-01", "2026-09-15", "2026-09-29"]);
  });

  it("expands a monthly recurrence, preserving the day of month", () => {
    const dates = expandRecurrenceDates("2026-01-15", { frequency: "monthly", count: 3 });
    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });

  it("expands a custom interval", () => {
    const dates = expandRecurrenceDates("2026-09-01", {
      frequency: "custom",
      intervalDays: 10,
      count: 3,
    });
    expect(dates).toEqual(["2026-09-01", "2026-09-11", "2026-09-21"]);
  });

  it("always includes the start date as the first occurrence", () => {
    const dates = expandRecurrenceDates("2026-09-01", { frequency: "weekly", count: 1 });
    expect(dates).toEqual(["2026-09-01"]);
  });
});
