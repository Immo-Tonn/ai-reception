import { addDays, resolveToday } from "./zonedTime";

export interface DateStripOptions {
  /** First selectable day, in days after the business "today" (default 0). */
  minDaysAhead?: number;
  /** Last selectable day, in days after the business "today" (default 13). */
  maxDaysAhead?: number;
}

/**
 * Booking date strip: consecutive calendar dates (YYYY-MM-DD) counted from the
 * BUSINESS "today". With a zone, "today" is that zone's day (independent of
 * UTC and of the visitor's browser zone); with `null` (demo presets without a
 * timezone) it is the browser-local date.
 */
export function buildDateStrip(
  now: Date,
  timeZone: string | null,
  { minDaysAhead = 0, maxDaysAhead = 13 }: DateStripOptions = {},
): string[] {
  const today = resolveToday(now, timeZone);
  const count = Math.max(0, maxDaysAhead - minDaysAhead + 1);
  return Array.from({ length: count }, (_, i) => addDays(today, minDaysAhead + i));
}

/** Short city label of an IANA zone ("Europe/Berlin" -> "Berlin"). */
export function zoneCityLabel(timeZone: string): string {
  const last = timeZone.split("/").pop() ?? timeZone;
  return last.replace(/_/g, " ");
}

/** The visitor's browser zone, or null when it cannot be determined. */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
