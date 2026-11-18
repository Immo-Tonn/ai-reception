import "server-only";
import type { Session } from "@/server/auth/session";
import { z } from "zod";
import { assertCan } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toRepositoryError } from "@/server/repository/errors";
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
    id: crypto.randomUUID(),
    lastVisit: null,
    upcoming: [],
    history: [],
  };
  const created = await getServerClientsRepository(session.workspaceId).create(client);
  await getServerAuditLogRepository(session.workspaceId).create({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action: "created",
    entityType: "client",
    entityId: created.id,
    summary: "Client created",
    source: "user",
  });
  return created;
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
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action: "updated",
      entityType: "client",
      entityId: id,
      summary: "Client updated",
      source: "user",
    });
  }
  return updated;
}

export type AnonymizeClientResult = { status: "anonymized" | "already" };

/**
 * GDPR erasure inside this workspace (migration 0028): personal data of the client
 * is removed or replaced by "Gelöschter Kunde" in one database transaction; invoices
 * and appointment facts stay. Owner only — the database checks it again.
 * Does NOT touch a client ACCOUNT (Supabase Auth), which is handled separately.
 */
export async function anonymizeClient(session: Session, id: string): Promise<AnonymizeClientResult> {
  assertCan(session.role, "clients.erase");
  const clientId = z.string().uuid().parse(id);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("anonymize_client", {
    p_workspace_id: session.workspaceId,
    p_client_id: clientId,
  });
  if (error) throw toRepositoryError(error, "clients.anonymize");
  return { status: (data as { status?: string } | null)?.status === "already" ? "already" : "anonymized" };
}
