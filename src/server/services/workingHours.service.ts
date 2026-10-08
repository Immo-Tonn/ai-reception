import "server-only";
import { ZodError } from "zod";
import type { Session } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";
import type { TimeOffEntry, WeeklyIntervals } from "@/features/scheduling/types";
import { hhmm, rowsFromWeekly, weeklyFromRows, type WorkingHoursRowLike } from "@/features/scheduling/weeklyEdit";
import {
  createTimeOffSchema,
  weeklyIntervalsSchema,
  type CreateTimeOffInput,
} from "@/server/validation/scheduling.schema";
import { assertCanRead, assertCanWrite, assertCanWriteCatalog, audit } from "./schedulingShared";

/**
 * Working hours (business weekly schedule + per-staff custom schedules) and time off.
 * Permission: `staff.manage`. Runs as the signed-in user (RLS = tenant isolation).
 */
type HoursRow = WorkingHoursRowLike & { id: string; staff_id: string | null };
const HOURS_COLUMNS = "id,staff_id,weekday,start_time,end_time,is_day_off";

export interface WorkingHoursSnapshot {
  business: WeeklyIntervals;
  /** Custom intervals of every staff member that has rows (inherit-mode people may still keep old rows). */
  staff: Record<string, WeeklyIntervals>;
}

export async function getWorkingHours(session: Session): Promise<WorkingHoursSnapshot> {
  assertCanRead(session, "staff.manage");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("working_hours").select(HOURS_COLUMNS).eq("workspace_id", session.workspaceId);
  if (error) throw toRepositoryError(error, "workingHours.list");
  const rows = (data as HoursRow[]) ?? [];
  const staffIds = [...new Set(rows.map((r) => r.staff_id).filter((x): x is string => x !== null))];
  return {
    business: weeklyFromRows(rows.filter((r) => r.staff_id === null)),
    staff: Object.fromEntries(staffIds.map((id) => [id, weeklyFromRows(rows.filter((r) => r.staff_id === id))])),
  };
}

/**
 * Replaces ALL intervals of one owner (`ownerId` null = the business) with `weekly`, already
 * validated, in ONE database transaction (`replace_working_hours`, migration 0020): either the new
 * week is stored or the previous one stays. The function runs with the caller's rights (RLS,
 * same-workspace guard and the overlap trigger still apply).
 * Internal: callers authorize and audit.
 */
export async function replaceWorkingHours(session: Session, ownerId: string | null, weekly: WeeklyIntervals): Promise<void> {
  const client = await createSupabaseServerClient();
  if (ownerId !== null) {
    const { data, error } = await client.from("staff_profiles").select("id").eq("workspace_id", session.workspaceId).eq("id", ownerId).maybeSingle();
    if (error) throw toRepositoryError(error, "workingHours.owner");
    if (!data) throw new RepositoryNotFoundError("workingHours.owner");
  }
  const rows = rowsFromWeekly(weekly).map((r) => ({
    weekday: r.weekday,
    start_time: r.start_time,
    end_time: r.end_time,
    is_day_off: r.is_day_off,
  }));
  const { error } = await client.rpc("replace_working_hours", { p_workspace_id: session.workspaceId, p_staff_id: ownerId, p_rows: rows });
  if (error) {
    // Row trigger (overlap / day-off mix) = invalid input, not a permission problem.
    if (/working_hours_(overlap|day_off_conflict)/.test(error.message ?? "")) throw new ZodError([]);
    throw toRepositoryError(error, "workingHours.replace");
  }
}

/** The business opening hours. A staff member in `inherit` mode works exactly these. */
export async function replaceBusinessWorkingHours(session: Session, input: WeeklyIntervals): Promise<WeeklyIntervals> {
  assertCanWriteCatalog(session);
  const weekly = weeklyIntervalsSchema.parse(input);
  await replaceWorkingHours(session, null, weekly);
  await audit(session, "updated", "workingHours", session.workspaceId, "Business opening hours updated");
  return (await getWorkingHours(session)).business;
}

/** Custom weekly schedule of a staff member without touching their mode (`setStaffSchedule` is the full flow). */
export async function replaceStaffWorkingHours(session: Session, staffId: string, input: WeeklyIntervals): Promise<WeeklyIntervals> {
  assertCanWriteCatalog(session);
  const weekly = weeklyIntervalsSchema.parse(input);
  await replaceWorkingHours(session, staffId, weekly);
  await audit(session, "updated", "workingHours", staffId, "Staff working hours updated");
  return (await getWorkingHours(session)).staff[staffId] ?? weekly;
}

/* ------------------------------ time off ------------------------------ */

type TimeOffRow = {
  id: string;
  staff_id: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};
const TIME_OFF_COLUMNS = "id,staff_id,start_date,end_date,start_time,end_time,reason";

function timeOffFromRow(r: TimeOffRow): TimeOffEntry {
  return {
    id: r.id,
    staffId: r.staff_id,
    startDate: r.start_date,
    endDate: r.end_date,
    startTime: r.start_time ? hhmm(r.start_time) : null,
    endTime: r.end_time ? hhmm(r.end_time) : null,
    reason: r.reason ?? "",
  };
}

/** Time off and business closures of the workspace (the reason is private to people with `staff.manage`). */
export async function listTimeOff(session: Session): Promise<TimeOffEntry[]> {
  assertCanRead(session, "staff.manage");
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("time_off")
    .select(TIME_OFF_COLUMNS)
    .eq("workspace_id", session.workspaceId)
    .order("start_date", { ascending: true })
    .limit(500);
  if (error) throw toRepositoryError(error, "timeOff.list");
  return ((data as TimeOffRow[]) ?? []).map(timeOffFromRow);
}

export async function createTimeOff(session: Session, input: CreateTimeOffInput): Promise<TimeOffEntry> {
  assertCanWrite(session, "staff.manage");
  const data = createTimeOffSchema.parse(input);
  const client = await createSupabaseServerClient();
  if (data.staffId) {
    const { data: staff, error } = await client.from("staff_profiles").select("id").eq("workspace_id", session.workspaceId).eq("id", data.staffId).maybeSingle();
    if (error) throw toRepositoryError(error, "timeOff.staff");
    if (!staff) throw new RepositoryNotFoundError("timeOff.staff");
  }
  const { data: row, error } = await client
    .from("time_off")
    .insert({
      workspace_id: session.workspaceId,
      staff_id: data.staffId,
      start_date: data.startDate,
      end_date: data.endDate,
      start_time: data.startTime,
      end_time: data.endTime,
      reason: data.reason,
      created_by: session.userId,
    })
    .select(TIME_OFF_COLUMNS)
    .single();
  if (error || !row) throw toRepositoryError(error, "timeOff.create");
  // The private reason is never copied into the audit log.
  await audit(session, "created", "timeOff", (row as TimeOffRow).id, data.staffId ? "Staff time off added" : "Business closure added");
  return timeOffFromRow(row as TimeOffRow);
}

export async function deleteTimeOff(session: Session, id: string): Promise<void> {
  assertCanWrite(session, "staff.manage");
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("time_off").select("id,staff_id").eq("workspace_id", session.workspaceId).eq("id", id).maybeSingle();
  if (error) throw toRepositoryError(error, "timeOff.get");
  if (!data) throw new RepositoryNotFoundError("timeOff.get");
  const { error: delError } = await client.from("time_off").delete().eq("workspace_id", session.workspaceId).eq("id", id);
  if (delError) throw toRepositoryError(delError, "timeOff.delete");
  await audit(session, "deleted", "timeOff", id, (data as { staff_id: string | null }).staff_id ? "Staff time off removed" : "Business closure removed");
}
