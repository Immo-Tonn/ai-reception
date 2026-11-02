"use server";

import { getSession } from "@/server/auth/session";
import * as exportService from "@/server/services/clientExport.service";
import type { DataSubjectRequestRow, DsrStatus } from "@/server/services/clientExport.service";
import { runAction, type ActionResult } from "./result";

export async function listDataSubjectRequestsAction(workspaceSlug: string, clientId: string): Promise<ActionResult<DataSubjectRequestRow[]>> {
  return runAction(async () => exportService.listDataSubjectRequests(await getSession(workspaceSlug), clientId));
}

export async function setDataSubjectRequestStatusAction(
  workspaceSlug: string,
  requestId: string,
  status: DsrStatus,
): Promise<ActionResult<void>> {
  return runAction(async () => exportService.setDataSubjectRequestStatus(await getSession(workspaceSlug), requestId, status));
}
