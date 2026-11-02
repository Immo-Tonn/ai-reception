import "server-only";
import { z } from "zod";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServerAuditLogRepository } from "@/server/repository/registry";
import { RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";
import { clientFromRow } from "@/server/repository/clientsSupabaseRepository";
import type { ClientRecord } from "@/features/clients/types";

/**
 * Archive / restore a client (migration 0032). Reversible; NOT an erasure:
 * only clients.archived_at changes. Appointments (also future ones), invoices,
 * notes and history stay exactly as they are. Owner and admin
 * (clients.archive); the database checks it again. An anonymised client
 * cannot be restored (database rule). Audit entries carry no personal data.
 */
export type ArchiveResult = { status: "archived" | "restored" | "unchanged"; archivedAt: string | null };

async function setArchived(session: Session, clientId: string, archive: boolean): Promise<ArchiveResult> {
  assertCan(session.role, "clients.archive");
  const id = z.string().uuid().parse(clientId);
  const db = await createSupabaseServerClient();
  // Only a row in the opposite state is changed: a repeated call is a no-op (no second audit entry).
  const base = db
    .from("clients")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("workspace_id", session.workspaceId)
    .eq("id", id);
  const { data: updated, error } = await (archive ? base.is("archived_at", null) : base.not("archived_at", "is", null)).select("archived_at");
  if (error) throw toRepositoryError(error, archive ? "clients.archive" : "clients.restore");
  if (updated && updated.length === 1) {
    await getServerAuditLogRepository(session.workspaceId).create({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action: "updated",
      entityType: "client",
      entityId: id,
      summary: archive ? "Client archived" : "Client restored from archive",
      source: "user",
    });
    return { status: archive ? "archived" : "restored", archivedAt: (updated[0] as { archived_at: string | null }).archived_at };
  }
  // Nothing changed: already in the requested state, or not a client of this workspace.
  const { data: row, error: readError } = await db
    .from("clients")
    .select("archived_at")
    .eq("workspace_id", session.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (readError) throw toRepositoryError(readError, "clients.archiveState");
  if (!row) throw new RepositoryNotFoundError("clients.archive");
  return { status: "unchanged", archivedAt: (row as { archived_at: string | null }).archived_at };
}

export function archiveClient(session: Session, clientId: string): Promise<ArchiveResult> {
  return setArchived(session, clientId, true);
}

export function restoreClient(session: Session, clientId: string): Promise<ArchiveResult> {
  return setArchived(session, clientId, false);
}

/** The archive view: archived clients of this workspace only (owner / admin). */
export async function listArchivedClients(session: Session): Promise<ClientRecord[]> {
  assertCan(session.role, "clients.archive");
  const db = await createSupabaseServerClient();
  const { data, error } = await db
    .from("clients")
    .select("*")
    .eq("workspace_id", session.workspaceId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });
  if (error) throw toRepositoryError(error, "clients.listArchived");
  const now = new Date();
  return ((data ?? []) as Parameters<typeof clientFromRow>[0][]).map((r) => clientFromRow(r, [], new Map(), now));
}
