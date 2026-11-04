"use server";

import { getSession } from "@/server/auth/session";
import * as archiveService from "@/server/services/clientArchive.service";
import type { ArchiveResult } from "@/server/services/clientArchive.service";
import type { ClientRecord } from "@/features/clients/types";
import { can } from "@/server/permissions/roles";
import { runAction, type ActionResult } from "./result";

export async function archiveClientAction(workspaceSlug: string, clientId: string): Promise<ActionResult<ArchiveResult>> {
  return runAction(async () => archiveService.archiveClient(await getSession(workspaceSlug), clientId));
}

export async function restoreClientAction(workspaceSlug: string, clientId: string): Promise<ActionResult<ArchiveResult>> {
  return runAction(async () => archiveService.restoreClient(await getSession(workspaceSlug), clientId));
}

export async function listArchivedClientsAction(workspaceSlug: string): Promise<ActionResult<ClientRecord[]>> {
  return runAction(async () => archiveService.listArchivedClients(await getSession(workspaceSlug)));
}

/** Only shows / hides the archive controls; the actions and the database enforce it. */
export async function canArchiveClientsAction(workspaceSlug: string): Promise<ActionResult<boolean>> {
  return runAction(async () => can((await getSession(workspaceSlug)).role, "clients.archive"));
}
