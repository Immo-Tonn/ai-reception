"use server";

import { getSession } from "@/server/auth/session";
import * as exportService from "@/server/services/clientExport.service";
import type { DataSubjectRequestRow, RequestAction } from "@/server/services/clientExport.service";
import { runAction, type ActionResult } from "./result";

export async function listDataSubjectRequestsAction(workspaceSlug: string, clientId: string): Promise<ActionResult<DataSubjectRequestRow[]>> {
  return runAction(async () => exportService.listDataSubjectRequests(await getSession(workspaceSlug), clientId));
}

export async function registerDataSubjectRequestAction(
  workspaceSlug: string,
  clientId: string,
  input: { type: DataSubjectRequestRow["requestType"]; receivedOn: string; dueOn: string; identityVerified: boolean },
): Promise<ActionResult<DataSubjectRequestRow>> {
  return runAction(async () => exportService.registerDataSubjectRequest(await getSession(workspaceSlug), clientId, input));
}

export async function applyDataSubjectRequestActionAction(
  workspaceSlug: string,
  requestId: string,
  action: RequestAction,
): Promise<ActionResult<DataSubjectRequestRow>> {
  return runAction(async () => exportService.applyDataSubjectRequestAction(await getSession(workspaceSlug), requestId, action));
}
