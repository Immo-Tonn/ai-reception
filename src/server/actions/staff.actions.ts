"use server";

import { getSession } from "@/server/auth/session";
import * as staff from "@/server/services/staffAdmin.service";
import type { StaffRecord, WeeklyIntervals } from "@/features/scheduling/types";
import type { CreateStaffInput, UpdateStaffInput } from "@/server/validation/scheduling.schema";
import { runAction, type ActionResult } from "./result";
import { revalidateScheduling } from "./schedulingRevalidate";

/** Staff management (permission `staff.manage`; demo workspaces are refused -> "forbidden"). */
async function run<T>(workspaceSlug: string, fn: (session: Awaited<ReturnType<typeof getSession>>) => Promise<T>): Promise<ActionResult<T>> {
  const result = await runAction(async () => fn(await getSession(workspaceSlug)));
  if (result.ok) revalidateScheduling(workspaceSlug);
  return result;
}

export async function createStaffAction(workspaceSlug: string, input: CreateStaffInput): Promise<ActionResult<StaffRecord>> {
  return run(workspaceSlug, (s) => staff.createStaff(s, input));
}

export async function updateStaffAction(workspaceSlug: string, id: string, input: UpdateStaffInput): Promise<ActionResult<StaffRecord>> {
  return run(workspaceSlug, (s) => staff.updateStaff(s, id, input));
}

/** Archive (false) / restore (true). Never deletes. */
export async function setStaffActiveAction(workspaceSlug: string, id: string, active: boolean): Promise<ActionResult<StaffRecord>> {
  return run(workspaceSlug, (s) => staff.setStaffActive(s, id, active));
}

/** `mode: "inherit"` = business hours; `mode: "custom"` + `weekly` replaces the person's own intervals. */
export async function setStaffScheduleAction(
  workspaceSlug: string,
  id: string,
  input: { mode: "inherit" } | { mode: "custom"; weekly: WeeklyIntervals },
): Promise<ActionResult<StaffRecord>> {
  return run(workspaceSlug, (s) => staff.setStaffSchedule(s, id, input as Parameters<typeof staff.setStaffSchedule>[2]));
}
