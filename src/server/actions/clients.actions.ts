"use server";

import { getSession } from "@/server/auth/session";
import * as clientsService from "@/server/services/clients.service";
import { runAction, type ActionResult } from "./result";
import type { CreateClientInput, UpdateClientInput } from "@/server/validation/client.schema";
import type { ClientRecord } from "@/features/clients/types";

export async function listClientsAction(workspaceSlug: string): Promise<ActionResult<ClientRecord[]>> {
  return runAction(async () => clientsService.listClients(await getSession(workspaceSlug)));
}

export async function getClientAction(workspaceSlug: string, id: string): Promise<ActionResult<ClientRecord | undefined>> {
  return runAction(async () => clientsService.getClient(await getSession(workspaceSlug), id));
}

export async function createClientAction(workspaceSlug: string, input: CreateClientInput): Promise<ActionResult<ClientRecord>> {
  return runAction(async () => clientsService.createClient(await getSession(workspaceSlug), input));
}

export async function updateClientAction(
  workspaceSlug: string,
  id: string,
  input: UpdateClientInput,
): Promise<ActionResult<ClientRecord | undefined>> {
  return runAction(async () => clientsService.updateClient(await getSession(workspaceSlug), id, input));
}
