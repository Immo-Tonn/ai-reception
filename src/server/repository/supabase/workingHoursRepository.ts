import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TimeRange, WeeklySchedule, WorkingHoursProfile } from "@/features/workingHours/types";

/**
 * Real working hours for a real workspace, read from `working_hours`:
 *  - rows with `staff_id is null` are the business-wide default schedule
 *    (profile `ownerId: "business"`);
 *  - rows with a `staff_id` are an individual override (profile
 *    `ownerId: <specialist name>`), which the availability engine already
 *    prefers over the business default.
 *
 * A workspace with NO rows at all is treated as closed on every day —
 * never "open 24/7" (the engine's behavior for a missing profile) — so
 * nobody can book before the owner has actually set working hours.
 */

interface HoursRow {
  staff_id: string | null;
  weekday: number;
  start_time: string | null;
  end_time: string | null;
  is_day_off: boolean;
  staff_profiles: { name: string } | null;
}

const CLOSED_WEEK: WeeklySchedule = { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };

function hhmm(value: string): string {
  return value.slice(0, 5);
}

function toRange(row: HoursRow): TimeRange | null {
  if (row.is_day_off || !row.start_time || !row.end_time) return null;
  return { start: hhmm(row.start_time), end: hhmm(row.end_time) };
}

export async function getSupabaseWorkingHours(workspaceId: string): Promise<WorkingHoursProfile[]> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("working_hours")
    .select("staff_id, weekday, start_time, end_time, is_day_off, staff_profiles(name)")
    .eq("workspace_id", workspaceId);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as HoursRow[];
  const profiles = new Map<string, WorkingHoursProfile>();

  profiles.set("business", {
    ownerId: "business",
    weekly: { ...CLOSED_WEEK },
    breaks: [],
    timeOff: [],
    blocks: [],
  });

  for (const row of rows) {
    const ownerId = row.staff_id === null ? "business" : (row.staff_profiles?.name ?? null);
    if (ownerId === null) continue;
    let profile = profiles.get(ownerId);
    if (!profile) {
      profile = { ownerId, weekly: { ...CLOSED_WEEK }, breaks: [], timeOff: [], blocks: [] };
      profiles.set(ownerId, profile);
    }
    profile.weekly[row.weekday] = toRange(row);
  }

  return [...profiles.values()];
}

/** Replaces the business-wide default schedule with `weekly`. */
export async function saveBusinessWorkingHours(
  workspaceId: string,
  weekly: WeeklySchedule,
): Promise<void> {
  const admin = createSupabaseAdminClient();

  const { error: deleteError } = await admin
    .from("working_hours")
    .delete()
    .eq("workspace_id", workspaceId)
    .is("staff_id", null);
  if (deleteError) throw new Error(deleteError.message);

  const rows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const range = weekly[weekday] ?? null;
    return {
      workspace_id: workspaceId,
      staff_id: null,
      weekday,
      start_time: range ? range.start : null,
      end_time: range ? range.end : null,
      is_day_off: range === null,
    };
  });
  const { error: insertError } = await admin.from("working_hours").insert(rows);
  if (insertError) throw new Error(insertError.message);
}
