"use server";

import { getSession } from "@/server/auth/session";
import * as clientsService from "@/server/services/clients.service";
import type { CreateClientInput, UpdateClientInput } from "@/server/validation/client.schema";
import type { ClientRecord } from "@/features/clients/types";
import { runAction } from "./runAction";
import type { ActionResult } from "./result";

export async function listClientsAction(workspaceSlug: string): Promise<ActionResult<ClientRecord[]>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    return clientsService.listClients(session);
  });
}

export async function createClientAction(
  workspaceSlug: string,
  input: CreateClientInput,
): Promise<ActionResult<ClientRecord>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    return clientsService.createClient(session, input);
  });
}

export async function updateClientAction(
  workspaceSlug: string,
  id: string,
  input: UpdateClientInput,
): Promise<ActionResult<ClientRecord | undefined>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    return clientsService.updateClient(session, id, input);
  });
}
