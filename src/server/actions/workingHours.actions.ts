"use server";

import { getSession } from "@/server/auth/session";
import * as hours from "@/server/services/workingHours.service";
import type { TimeOffEntry, WeeklyIntervals } from "@/features/scheduling/types";
import type { CreateTimeOffInput } from "@/server/validation/scheduling.schema";
import { runAction, type ActionResult } from "./result";
import { revalidateScheduling } from "./schedulingRevalidate";

/** Working hours and time off (permission `staff.manage`; demo workspaces are refused -> "forbidden"). */
async function run<T>(workspaceSlug: string, fn: (session: Awaited<ReturnType<typeof getSession>>) => Promise<T>): Promise<ActionResult<T>> {
  const result = await runAction(async () => fn(await getSession(workspaceSlug)));
  if (result.ok) revalidateScheduling(workspaceSlug);
  return result;
}

/** Replace-all: the business weekly schedule (several intervals per day, closed day = none). */
export async function replaceBusinessHoursAction(workspaceSlug: string, weekly: WeeklyIntervals): Promise<ActionResult<WeeklyIntervals>> {
  return run(workspaceSlug, (s) => hours.replaceBusinessWorkingHours(s, weekly));
}

export async function createTimeOffAction(workspaceSlug: string, input: CreateTimeOffInput): Promise<ActionResult<TimeOffEntry>> {
  return run(workspaceSlug, (s) => hours.createTimeOff(s, input));
}

export async function deleteTimeOffAction(workspaceSlug: string, id: string): Promise<ActionResult<null>> {
  return run(workspaceSlug, async (s) => {
    await hours.deleteTimeOff(s, id);
    return null;
  });
}
