import type { TimeInterval, WeeklyIntervals } from "./types";

/**
 * Pure helpers of the working-hours WRITE side (editor + server validation share them,
 * so the browser and the server apply exactly the same rules). No Date, no I/O.
 */
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_INTERVALS_PER_DAY = 4;
/** Display order of the week (Monday first); weekday numbers stay Date#getDay (0 = Sunday). */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export type WeeklyIssueCode = "bad_weekday" | "bad_time" | "end_not_after_start" | "overlap" | "too_many";
export interface WeeklyIssue {
  weekday: number;
  code: WeeklyIssueCode;
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** First problem found, or null when the week is valid. A day with no intervals is simply closed. */
export function validateWeekly(weekly: WeeklyIntervals): WeeklyIssue | null {
  for (const [key, list] of Object.entries(weekly)) {
    const weekday = Number(key);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return { weekday, code: "bad_weekday" };
    if (list.length > MAX_INTERVALS_PER_DAY) return { weekday, code: "too_many" };
    for (const interval of list) {
      if (!HHMM.test(interval.start) || !HHMM.test(interval.end)) return { weekday, code: "bad_time" };
      if (minutesOf(interval.end) <= minutesOf(interval.start)) return { weekday, code: "end_not_after_start" };
    }
    const sorted = [...list].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
    for (let i = 1; i < sorted.length; i++) {
      if (minutesOf(sorted[i].start) < minutesOf(sorted[i - 1].end)) return { weekday, code: "overlap" };
    }
  }
  return null;
}

/** All seven days present, each list sorted by start. */
export function normalizeWeekly(weekly: WeeklyIntervals): WeeklyIntervals {
  const out: WeeklyIntervals = {};
  for (let d = 0; d < 7; d++) {
    out[d] = [...(weekly[d] ?? [])].map((i) => ({ start: i.start, end: i.end })).sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  }
  return out;
}

export function emptyWeek(): WeeklyIntervals {
  return normalizeWeekly({});
}

export function cloneWeekly(weekly: WeeklyIntervals): WeeklyIntervals {
  return normalizeWeekly(weekly);
}

export function sameWeekly(a: WeeklyIntervals, b: WeeklyIntervals): boolean {
  return JSON.stringify(normalizeWeekly(a)) === JSON.stringify(normalizeWeekly(b));
}

/** Copies one day's intervals onto the other days. */
export function copyDay(weekly: WeeklyIntervals, from: number, to: readonly number[]): WeeklyIntervals {
  const next = normalizeWeekly(weekly);
  for (const day of to) if (day !== from) next[day] = (weekly[from] ?? []).map((i) => ({ ...i }));
  return next;
}

export const DEFAULT_INTERVAL: TimeInterval = { start: "09:00", end: "17:00" };

/** A DB `time` value ("09:00:00") -> "09:00". */
export function hhmm(value: string | null): string {
  return (value ?? "").slice(0, 5);
}

export interface WorkingHoursRowLike {
  weekday: number;
  start_time: string | null;
  end_time: string | null;
  is_day_off: boolean;
}

/** Rows of ONE owner -> weekly intervals. Day-off rows (or no rows) = closed. */
export function weeklyFromRows(rows: WorkingHoursRowLike[]): WeeklyIntervals {
  const week = emptyWeek();
  for (const row of rows) {
    if (row.is_day_off || !row.start_time || !row.end_time) continue;
    week[row.weekday]?.push({ start: hhmm(row.start_time), end: hhmm(row.end_time) });
  }
  return normalizeWeekly(week);
}

/** Weekly intervals -> rows to store: an explicit day-off row for every closed day. */
export function rowsFromWeekly(weekly: WeeklyIntervals): WorkingHoursRowLike[] {
  const week = normalizeWeekly(weekly);
  const rows: WorkingHoursRowLike[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    if (week[weekday].length === 0) rows.push({ weekday, start_time: null, end_time: null, is_day_off: true });
    for (const i of week[weekday]) rows.push({ weekday, start_time: i.start, end_time: i.end, is_day_off: false });
  }
  return rows;
}

/** Demo `WeeklySchedule` values (`null`, one range or a list per weekday) -> weekly intervals. */
export function weeklyFromSchedule(schedule: Record<number, { start: string; end: string } | { start: string; end: string }[] | null | undefined>): WeeklyIntervals {
  const out = emptyWeek();
  for (const [day, value] of Object.entries(schedule)) {
    const list = !value ? [] : Array.isArray(value) ? value : [value];
    out[Number(day)] = list.map((r) => ({ start: r.start, end: r.end }));
  }
  return normalizeWeekly(out);
}
