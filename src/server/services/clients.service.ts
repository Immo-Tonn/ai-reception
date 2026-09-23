import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getServerClientsRepository, getServerAuditLogRepository } from "@/server/repository/registry";
import {
  createClientSchema,
  updateClientSchema,
  type CreateClientInput,
  type UpdateClientInput,
} from "@/server/validation/client.schema";
import type { ClientRecord } from "@/features/clients/types";

export async function listClients(session: Session): Promise<ClientRecord[]> {
  assertCan(session.role, "clients.view");
  return getServerClientsRepository(session.workspaceId).list();
}

export async function getClient(session: Session, id: string): Promise<ClientRecord | undefined> {
  assertCan(session.role, "clients.view");
  return getServerClientsRepository(session.workspaceId).get(id);
}

export async function createClient(
  session: Session,
  input: CreateClientInput,
): Promise<ClientRecord> {
  assertCan(session.role, "clients.edit");
  const data = createClientSchema.parse(input);
  const client: ClientRecord = {
    ...data,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    lastVisit: null,
    upcoming: [],
    history: [],
  };
  await getServerClientsRepository(session.workspaceId).create(client);
  await getServerAuditLogRepository(session.workspaceId).create({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    action: "created",
    entityType: "client",
    entityId: client.id,
    summary: client.name,
    source: "user",
  });
  return client;
}

export async function updateClient(
  session: Session,
  id: string,
  input: UpdateClientInput,
): Promise<ClientRecord | undefined> {
  assertCan(session.role, "clients.edit");
  const patch = updateClientSchema.parse(input);
  const updated = await getServerClientsRepository(session.workspaceId).update(id, patch);
  if (updated) {
    await getServerAuditLogRepository(session.workspaceId).create({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      action: "updated",
      entityType: "client",
      entityId: id,
      summary: updated.name,
      source: "user",
    });
  }
  return updated;
}
