import type { WorkingHoursProfile, WeeklySchedule, TimeRange } from "@/features/workingHours/types";
import type { ScheduleMode } from "@/features/scheduling/types";
import { addDays } from "@/lib/time/zonedTime";

/** One `working_hours` row. `staff_id = null` is the workspace-wide default (opening hours). */
export interface WorkingHoursRow {
  staff_id: string | null;
  weekday: number;
  start_time: string | null;
  end_time: string | null;
  is_day_off: boolean;
}

/** One `time_off` row. `staff_id = null` = the whole business is closed. No times = full day(s). */
export interface TimeOffRow {
  staff_id: string | null;
  start_date: string;
  end_date: string;
  start_time?: string | null;
  end_time?: string | null;
  reason?: string | null;
}

const hhmm = (t: string) => t.slice(0, 5);
const MAX_EXPANDED_DAYS = 366;

/**
 * Rows -> the profiles the availability engine reads: one per staff id (the
 * engine's `ownerId` is the stable staff id) plus the "business" default.
 *
 *  - Several interval rows per weekday become a list; a day-off row (or a
 *    weekday without rows) is closed.
 *  - Business time off = closure for EVERYONE ("business" profile); staff time
 *    off applies to that person. A full day (no times) becomes `timeOff`, a
 *    partial day becomes a `blocks` entry.
 *  - `staffModes`: "inherit" = business hours (own rows ignored), "custom" =
 *    own rows intersected with the business hours. A staff member WITHOUT an
 *    entry keeps the legacy rule: own rows => custom, none => business hours.
 *    "custom" without any rows = no hours = closed (nothing was entered).
 *
 * Default-deny: when a workspace has no business rows, the "business" profile
 * is created with every day OFF — the engine treats a missing profile as
 * "always open", which must never happen for a real business.
 */
export function workingHoursFromRows(
  rows: WorkingHoursRow[],
  timeOffRows: TimeOffRow[] = [],
  staffModes: Record<string, ScheduleMode> = {},
): WorkingHoursProfile[] {
  const weeklyByOwner = new Map<string, WeeklySchedule>();
  const dayOff = new Set<string>();
  for (const row of rows) {
    const owner = row.staff_id ?? "business";
    const weekly = weeklyByOwner.get(owner) ?? {};
    weeklyByOwner.set(owner, weekly);
    const key = `${owner}|${row.weekday}`;
    if (row.is_day_off || !row.start_time || !row.end_time) {
      dayOff.add(key);
      weekly[row.weekday] = null;
      continue;
    }
    if (dayOff.has(key)) continue; // a day-off row beats intervals on the same weekday
    const range: TimeRange = { start: hhmm(row.start_time), end: hhmm(row.end_time) };
    const current = weekly[row.weekday];
    weekly[row.weekday] = Array.isArray(current) ? [...current, range] : current ? [current, range] : range;
  }

  const owners = new Set<string>(["business", ...weeklyByOwner.keys(), ...Object.keys(staffModes)]);
  for (const t of timeOffRows) owners.add(t.staff_id ?? "business");

  const profiles = new Map<string, WorkingHoursProfile>();
  for (const ownerId of owners) {
    const isBusiness = ownerId === "business";
    const mode = isBusiness ? undefined : staffModes[ownerId];
    const own = weeklyByOwner.get(ownerId);
    const weekly: WeeklySchedule = mode === "inherit" ? {} : (own ?? {});
    profiles.set(ownerId, {
      ownerId,
      weekly,
      ...(mode ? { mode } : {}),
      breaks: [],
      timeOff: [],
      blocks: [],
    });
  }
  // Legacy guard: a staff profile that only exists for time off (no rows, no mode) must not
  // silently turn into "custom + closed"; it works the business hours.
  for (const [ownerId, profile] of profiles) {
    if (ownerId !== "business" && !profile.mode && !weeklyByOwner.has(ownerId)) profile.mode = "inherit";
  }

  for (const t of timeOffRows) {
    const profile = profiles.get(t.staff_id ?? "business");
    if (!profile || !t.start_date || !t.end_date || t.end_date < t.start_date) continue;
    if (!t.start_time || !t.end_time) {
      profile.timeOff.push({ startDate: t.start_date, endDate: t.end_date, ...(t.reason ? { reason: t.reason } : {}) });
      continue;
    }
    // Partial day(s): block that time window on each date (the database allows one date; be tolerant).
    let date = t.start_date;
    for (let i = 0; i < MAX_EXPANDED_DAYS && date <= t.end_date; i++, date = addDays(date, 1)) {
      profile.blocks.push({ date, start: hhmm(t.start_time), end: hhmm(t.end_time), ...(t.reason ? { reason: t.reason } : {}) });
    }
  }

  return [...profiles.values()];
}
