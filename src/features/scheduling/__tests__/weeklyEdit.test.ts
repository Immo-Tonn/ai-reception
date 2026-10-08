import { describe, expect, it } from "vitest";
import { bookingRulesSchema, createTimeOffSchema, weeklyIntervalsSchema } from "@/server/validation/scheduling.schema";
import { copyDay, emptyWeek, rowsFromWeekly, sameWeekly, validateWeekly, weeklyFromRows } from "../weeklyEdit";

describe("weekly intervals", () => {
  it("validates HH:mm, end > start, overlap, max 4", () => {
    expect(validateWeekly({ 1: [{ start: "09:00", end: "17:00" }] })).toBeNull();
    expect(validateWeekly({ 1: [{ start: "09:00", end: "12:00" }, { start: "12:00", end: "15:00" }] })).toBeNull();
    expect(validateWeekly({ 1: [{ start: "9:00", end: "17:00" }] })?.code).toBe("bad_time");
    expect(validateWeekly({ 1: [{ start: "10:00", end: "10:00" }] })?.code).toBe("end_not_after_start");
    expect(validateWeekly({ 2: [{ start: "09:00", end: "12:00" }, { start: "11:00", end: "13:00" }] })).toEqual({ weekday: 2, code: "overlap" });
    expect(validateWeekly({ 3: [1, 2, 3, 4, 5].map((i) => ({ start: `0${i}:00`, end: `0${i}:30` })) })?.code).toBe("too_many");
  });

  it("zod schema normalises to seven sorted days; a closed day has no intervals", () => {
    const out = weeklyIntervalsSchema.parse({ "1": [{ start: "13:00", end: "14:00" }, { start: "09:00", end: "10:00" }] });
    expect(Object.keys(out)).toHaveLength(7);
    expect(out[1].map((i) => i.start)).toEqual(["09:00", "13:00"]);
    expect(out[0]).toEqual([]);
    expect(() => weeklyIntervalsSchema.parse({ "9": [] })).toThrow();
  });

  it("rows round-trip; closed days become explicit day-off rows", () => {
    const week = { ...emptyWeek(), 1: [{ start: "09:00", end: "12:00" }, { start: "13:00", end: "17:00" }] };
    const rows = rowsFromWeekly(week);
    expect(rows.filter((r) => r.is_day_off)).toHaveLength(6);
    expect(sameWeekly(weeklyFromRows(rows.map((r) => ({ ...r, start_time: r.start_time && `${r.start_time}:00`, end_time: r.end_time && `${r.end_time}:00` }))), week)).toBe(true);
  });

  it("copyDay copies one day onto the others", () => {
    const week = { ...emptyWeek(), 1: [{ start: "09:00", end: "17:00" }] };
    const copied = copyDay(week, 1, [1, 2, 3, 4, 5]);
    expect(copied[5]).toEqual([{ start: "09:00", end: "17:00" }]);
    expect(copied[0]).toEqual([]);
  });
});

describe("time off and booking rules schemas", () => {
  it("time off: full days or one partial day", () => {
    const base = { staffId: null, startDate: "2030-01-01", endDate: "2030-01-03" };
    expect(createTimeOffSchema.safeParse(base).success).toBe(true);
    expect(createTimeOffSchema.safeParse({ ...base, endDate: "2030-01-01", startTime: "09:00", endTime: "10:00" }).success).toBe(true);
    expect(createTimeOffSchema.safeParse({ ...base, startTime: "09:00", endTime: "10:00" }).success).toBe(false);
    expect(createTimeOffSchema.safeParse({ ...base, endDate: "2029-12-31" }).success).toBe(false);
  });

  it("booking rules bounds", () => {
    const ok = { autoConfirm: false, minNoticeMinutes: 0, maxHorizonDays: 90, slotIntervalMinutes: 15, cancellationDeadlineHours: 0, rescheduleDeadlineHours: 0 };
    expect(bookingRulesSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ maxHorizonDays: 0 }, { maxHorizonDays: 181 }, { slotIntervalMinutes: 25 }, { cancellationDeadlineHours: 721 }]) {
      expect(bookingRulesSchema.safeParse({ ...ok, ...bad }).success).toBe(false);
    }
  });
});
