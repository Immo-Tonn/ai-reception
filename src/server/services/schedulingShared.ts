import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan, type Permission } from "@/server/permissions/roles";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RepositoryForbiddenError, toRepositoryError } from "@/server/repository/errors";
import { getServerAuditLogRepository } from "@/server/repository/registry";
import type { AuditLogEntry } from "@/features/auditLog/types";

/**
 * Gate of every write in the staff / scheduling stage: the permission first (default-deny),
 * then the demo guard. Demo workspaces are fixed read-only presets: a write is refused
 * (-> "forbidden") before any repository is touched. The workspace comes from the SESSION only.
 */
export function assertCanWrite(session: Session, permission: Permission): void {
  assertCan(session.role, permission);
  if (isDemoWorkspaceSlug(session.workspaceId)) throw new RepositoryForbiddenError("demo workspace is read-only");
}

/**
 * Writes whose Row Level Security policy needs `settings.manage` (working_hours, resources, service_staff)
 * require it IN ADDITION to `staff.manage`; owner and admin hold both. time_off / service_resources
 * need only `staff.manage` (use assertCanWrite).
 */
export function assertCanWriteCatalog(session: Session): void {
  assertCan(session.role, "staff.manage");
  assertCan(session.role, "settings.manage");
  if (isDemoWorkspaceSlug(session.workspaceId)) throw new RepositoryForbiddenError("demo workspace is read-only");
}

/** Read gate: members with the management permission may see the management data (default-deny). */
export function assertCanRead(session: Session, permission: Permission): void {
  assertCan(session.role, permission);
  if (isDemoWorkspaceSlug(session.workspaceId)) throw new RepositoryForbiddenError("demo workspace has no database");
}

/** One audit entry per save (never per click). No secrets, no private reasons, no personal data beyond a business-entered name. */
export async function audit(
  session: Session,
  action: AuditLogEntry["action"],
  entityType: AuditLogEntry["entityType"],
  entityId: string,
  summary: string,
): Promise<void> {
  await getServerAuditLogRepository(session.workspaceId).create({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    entityType,
    entityId,
    summary,
    source: "user",
  });
}

/** Makes the links of ONE side equal to `wanted`: inserts the missing, deletes the removed (diff, never delete-all). */
export async function syncLinks(
  client: SupabaseClient,
  table: "service_staff" | "service_resources",
  fixedColumn: "staff_id" | "resource_id",
  fixedId: string,
  wanted: string[],
  context: string,
): Promise<{ added: string[]; removed: string[] }> {
  const { data, error } = await client.from(table).select("service_id").eq(fixedColumn, fixedId);
  if (error) throw toRepositoryError(error, context);
  const current = new Set(((data as { service_id: string }[]) ?? []).map((l) => l.service_id));
  const want = new Set(wanted);
  const added = [...want].filter((id) => !current.has(id));
  const removed = [...current].filter((id) => !want.has(id));
  if (added.length > 0) {
    const { error: e } = await client.from(table).insert(added.map((service_id) => ({ service_id, [fixedColumn]: fixedId })));
    if (e) throw toRepositoryError(e, context);
  }
  if (removed.length > 0) {
    const { error: e } = await client.from(table).delete().eq(fixedColumn, fixedId).in("service_id", removed);
    if (e) throw toRepositoryError(e, context);
  }
  return { added, removed };
}

/** Next free `sort_order` (steps of 10 so a manual reorder can slot in between). */
export async function nextSortOrder(session: Session, table: "staff_profiles" | "resources"): Promise<number> {
  const client = await createSupabaseServerClient();
  const { data } = await client.from(table).select("sort_order").eq("workspace_id", session.workspaceId).order("sort_order", { ascending: false }).limit(1);
  const top = ((data as { sort_order: number | null }[]) ?? [])[0]?.sort_order ?? -10;
  return Math.min(9999, top + 10);
}

/** Name of the business being edited (shown on every settings page). Any member may read it. */
export async function getBusinessName(session: Session): Promise<string> {
  const client = await createSupabaseServerClient();
  const { data } = await client.from("workspaces").select("name").eq("id", session.workspaceId).maybeSingle();
  return ((data as { name?: string } | null)?.name ?? "").trim();
}
