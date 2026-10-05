"use server";

import { getSession } from "@/server/auth/session";
import * as analyticsService from "@/server/services/analytics.service";
import { runAction, type ActionResult } from "./result";
import type { AnalyticsOverview } from "@/features/analytics/overview";

/** `from` / `to` are inclusive workspace-local days (YYYY-MM-DD); validated with zod in the service. */
export async function getAnalyticsOverviewAction(
  workspaceSlug: string,
  range: { from: string; to: string },
): Promise<ActionResult<AnalyticsOverview>> {
  return runAction(async () => analyticsService.getAnalyticsOverview(await getSession(workspaceSlug), range));
}
