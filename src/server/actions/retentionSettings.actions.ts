"use server";

import { getSession } from "@/server/auth/session";
import * as retentionService from "@/server/services/retentionSettings.service";
import type { RetentionSettings } from "@/server/services/retentionSettings.service";
import { runAction, type ActionResult } from "./result";

export async function updateClientRetentionMonthsAction(workspaceSlug: string, months: number): Promise<ActionResult<RetentionSettings>> {
  return runAction(async () => retentionService.updateClientRetentionMonths(await getSession(workspaceSlug), months));
}
