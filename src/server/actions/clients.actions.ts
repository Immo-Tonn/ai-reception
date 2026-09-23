"use server";

import { getSession } from "@/server/auth/session";
import * as clientsService from "@/server/services/clients.service";
import type { CreateClientInput, UpdateClientInput } from "@/server/validation/client.schema";

export async function listClientsAction(workspaceId: string) {
  const session = await getSession(workspaceId);
  return clientsService.listClients(session);
}

export async function createClientAction(workspaceId: string, input: CreateClientInput) {
  const session = await getSession(workspaceId);
  return clientsService.createClient(session, input);
}

export async function updateClientAction(
  workspaceId: string,
  id: string,
  input: UpdateClientInput,
) {
  const session = await getSession(workspaceId);
  return clientsService.updateClient(session, id, input);
}
