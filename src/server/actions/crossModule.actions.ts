"use server";

import { getSession } from "@/server/auth/session";
import * as crossModuleService from "@/server/services/crossModule.service";
import { runAction, type ActionResult } from "./result";
import type { ClientRelated } from "@/features/crossModule/types";

export async function getClientRelatedAction(workspaceSlug: string, clientId: string): Promise<ActionResult<ClientRelated>> {
  return runAction(async () => crossModuleService.getClientRelated(await getSession(workspaceSlug), clientId));
}
