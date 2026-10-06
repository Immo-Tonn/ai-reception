"use server";

import { getSession } from "@/server/auth/session";
import * as hoursService from "@/server/services/workingHours.service";
import type { TimeRange } from "@/features/workingHours/types";

export async function getBusinessHoursAction(workspaceSlug: string): Promise<(TimeRange | null)[]> {
  const session = await getSession(workspaceSlug);
  return hoursService.getBusinessHours(session);
}

export async function saveBusinessHoursAction(
  workspaceSlug: string,
  days: (TimeRange | null)[],
): Promise<{ ok: true } | { ok: false }> {
  try {
    const session = await getSession(workspaceSlug);
    await hoursService.saveBusinessHours(session, days);
    return { ok: true };
  } catch (error) {
    console.error("[workingHours.actions]", error);
    return { ok: false };
  }
}
