import type { BusyInterval } from "./types";

/** Safety cap per connection: a calendar with more busy blocks than this in the window is treated as unusable. */
export const MAX_BUSY_INTERVALS = 5000;

export class BusyIntervalOverflowError extends Error {
  constructor() {
    super("Too many busy intervals.");
    this.name = "BusyIntervalOverflowError";
  }
}

const parse = (value: unknown): number => (typeof value === "string" ? Date.parse(value) : NaN);

/**
 * Provider busy blocks -> sorted, merged, clipped intervals inside
 * [windowFrom, windowUntil). Anything unparsable or empty is dropped (an
 * invalid block from a provider must never turn into "free" — it only cannot
 * turn into "busy" either, which is why a malformed RESPONSE is rejected by
 * the provider adapter before it gets here). Only start/end survive.
 */
export function normalizeBusyIntervals(
  raw: ReadonlyArray<{ start?: unknown; end?: unknown }>,
  windowFrom: Date,
  windowUntil: Date,
): BusyInterval[] {
  const lo = windowFrom.getTime();
  const hi = windowUntil.getTime();
  const ranges: [number, number][] = [];
  for (const item of raw) {
    const s = Math.max(parse(item.start), lo);
    const e = Math.min(parse(item.end), hi);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    ranges.push([s, e]);
  }
  if (ranges.length > MAX_BUSY_INTERVALS) throw new BusyIntervalOverflowError();
  ranges.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [s, e] of ranges) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged.map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));
}

/** Intervals overlapping [from, until), clipped to it. Input must be normalized. */
export function clipBusyIntervals(intervals: readonly BusyInterval[], from: Date, until: Date): BusyInterval[] {
  return normalizeBusyIntervals(intervals, from, until);
}

/** Is a stored JSON value a list of valid intervals? (Defensive read of the cache column.) */
export function parseStoredBusy(value: unknown): BusyInterval[] | null {
  if (!Array.isArray(value)) return null;
  const out: BusyInterval[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const { start, end } = item as { start?: unknown; end?: unknown };
    if (!Number.isFinite(parse(start)) || !Number.isFinite(parse(end))) return null;
    out.push({ start: start as string, end: end as string });
  }
  return out;
}
