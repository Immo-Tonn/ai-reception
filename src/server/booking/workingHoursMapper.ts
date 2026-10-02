import type { WorkingHoursProfile, WeeklySchedule, Weekday } from "@/features/workingHours/types";

/** One `working_hours` row. `staff_id = null` is the workspace-wide default. */
export interface WorkingHoursRow {
  staff_id: string | null;
  weekday: number;
  start_time: string | null;
  end_time: string | null;
  is_day_off: boolean;
}

const hhmm = (t: string) => t.slice(0, 5);

/**
 * Rows -> the profiles the availability engine reads: one per staff id (the
 * engine's `ownerId` is the stable staff id) plus the "business" default.
 *
 * Default-deny: when a workspace has no rows at all, the "business" profile
 * is created with every day OFF — the engine treats a missing profile as
 * "always open", which must never happen for a real business.
 * Breaks, time off and one-off blocks have no tables yet (later phase).
 */
export function workingHoursFromRows(rows: WorkingHoursRow[]): WorkingHoursProfile[] {
  const byOwner = new Map<string, WeeklySchedule>();
  for (const row of rows) {
    const owner = row.staff_id ?? "business";
    const weekly = byOwner.get(owner) ?? {};
    weekly[row.weekday as Weekday] =
      row.is_day_off || !row.start_time || !row.end_time ? null : { start: hhmm(row.start_time), end: hhmm(row.end_time) };
    byOwner.set(owner, weekly);
  }
  if (!byOwner.has("business")) byOwner.set("business", {});
  return [...byOwner.entries()].map(([ownerId, weekly]) => ({ ownerId, weekly, breaks: [], timeOff: [], blocks: [] }));
}
