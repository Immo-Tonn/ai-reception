import type { TimeRange } from "@/features/workingHours/types";
import { addDays } from "@/lib/time/zonedTime";

/**
 * Pure wall-clock interval math of the ONE availability engine
 * (docs/STAFF_SCHEDULING.md). Everything is minutes since midnight of a
 * workspace-local day; no Date, no time zone, no clock.
 */

export interface MinuteInterval {
  start: number;
  end: number; // exclusive
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Weekday (0 = Sunday) of a calendar date, independent of any time zone. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Sorts and merges overlapping/touching intervals; drops empty or invalid ones. */
export function mergeIntervals(list: MinuteInterval[]): MinuteInterval[] {
  const sorted = list
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start)
    .map((i) => ({ start: Math.max(0, i.start), end: Math.min(24 * 60, i.end) }))
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out: MinuteInterval[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (last && item.start <= last.end) last.end = Math.max(last.end, item.end);
    else out.push({ ...item });
  }
  return out;
}

/** Weekly value (`null`, one range or a list) -> normalised minute intervals. */
export function dayIntervals(value: TimeRange | TimeRange[] | null | undefined): MinuteInterval[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return mergeIntervals(list.map((r) => ({ start: toMinutes(r.start), end: toMinutes(r.end) })));
}

/** Intersection of two normalised interval lists. */
export function intersectIntervals(a: MinuteInterval[], b: MinuteInterval[]): MinuteInterval[] {
  const out: MinuteInterval[] = [];
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return mergeIntervals(out);
}

/** `a` minus every interval in `cut`. */
export function subtractIntervals(a: MinuteInterval[], cut: MinuteInterval[]): MinuteInterval[] {
  let rest = mergeIntervals(a);
  for (const c of mergeIntervals(cut)) {
    const next: MinuteInterval[] = [];
    for (const r of rest) {
      if (c.end <= r.start || c.start >= r.end) {
        next.push(r);
        continue;
      }
      if (c.start > r.start) next.push({ start: r.start, end: c.start });
      if (c.end < r.end) next.push({ start: c.end, end: r.end });
    }
    rest = next;
  }
  return rest;
}

/** True when [start, end) lies entirely inside ONE of the intervals. */
export function fitsInside(intervals: MinuteInterval[], start: number, end: number): boolean {
  return intervals.some((i) => start >= i.start && end <= i.end);
}

export function overlaps(intervals: MinuteInterval[], start: number, end: number): boolean {
  return intervals.some((i) => start < i.end && end > i.start);
}

/** `[today, today + maxHorizonDays]` in workspace calendar days (`today` = workspace-local date). */
export function isWithinHorizon(date: string, today: string, maxHorizonDays: number): boolean {
  return date >= today && date <= addDays(today, maxHorizonDays);
}

export const SLOT_INTERVAL_DEFAULT = 15;

/** Start times of a service on the grid of `step` minutes inside ONE interval. */
export function gridStarts(interval: MinuteInterval, durationMinutes: number, step: number): number[] {
  const safeStep = Number.isInteger(step) && step > 0 ? step : SLOT_INTERVAL_DEFAULT;
  const out: number[] = [];
  for (let t = Math.ceil(interval.start / safeStep) * safeStep; t + durationMinutes <= interval.end; t += safeStep) {
    out.push(t);
  }
  return out;
}
