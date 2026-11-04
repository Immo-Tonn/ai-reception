import "server-only";
import { z } from "zod";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toRepositoryError } from "@/server/repository/errors";
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

/** One database transaction: status and audit entry together (0032, set_client_archived). */
async function setArchived(session: Session, clientId: string, archive: boolean): Promise<ArchiveResult> {
  assertCan(session.role, "clients.archive");
  const id = z.string().uuid().parse(clientId);
  const db = await createSupabaseServerClient();
  const { data, error } = await db.rpc("set_client_archived", {
    p_workspace_id: session.workspaceId,
    p_client_id: id,
    p_archive: archive,
  });
  if (error) throw toRepositoryError(error, archive ? "clients.archive" : "clients.restore");
  return data as ArchiveResult;
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
