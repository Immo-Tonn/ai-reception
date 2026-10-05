import "server-only";
import type { Session } from "@/server/auth/session";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";
import type { ResourceRecord } from "@/features/scheduling/types";
import {
  createResourceSchema,
  updateResourceSchema,
  type CreateResourceInput,
  type UpdateResourceInput,
} from "@/server/validation/scheduling.schema";
import { BusinessRuleError } from "./businessRuleError";
import { assertCanRead, assertCanWriteCatalog, audit, nextSortOrder, syncLinks } from "./schedulingShared";

/**
 * Resources (rooms, vehicles, equipment, ...): exclusive reservations of capacity 1. Permission
 * `staff.manage`. Archived with `active = false`, never hard deleted.
 *
 * RULE (resource type vs. service links), kept deliberately simple:
 *  - A service needs a resource iff `services.required_resource_type` is set.
 *  - Linking a resource to a service (service_resources) means "this service may use it", so the
 *    service must have a required type: linking sets it to the resource's type when the service
 *    has none, and is REFUSED (`BusinessRuleError resource_type_mismatch` -> "conflict") when the
 *    service already requires a different type.
 *  - Unlinking never clears the type (the service then falls back to every active resource of
 *    that type). A resource that still has links cannot change its type (unlink first).
 */
type Row = { id: string; name: string; type: string; description: string | null; active: boolean; sort_order: number | null };
const COLUMNS = "id,name,type,description,active,sort_order";

function fromRow(row: Row, serviceIds: string[]): ResourceRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description ?? "",
    active: row.active,
    sortOrder: row.sort_order ?? 0,
    serviceIds,
  };
}

export async function listResourcesAdmin(session: Session): Promise<ResourceRecord[]> {
  assertCanRead(session, "staff.manage");
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("resources")
    .select(COLUMNS)
    .eq("workspace_id", session.workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw toRepositoryError(error, "resources.list");
  const rows = (data as Row[]) ?? [];
  if (rows.length === 0) return [];
  const { data: links, error: linkError } = await client.from("service_resources").select("service_id,resource_id").in("resource_id", rows.map((r) => r.id));
  if (linkError) throw toRepositoryError(linkError, "resources.links");
  const byResource = new Map<string, string[]>();
  for (const l of (links as { service_id: string; resource_id: string }[]) ?? []) byResource.set(l.resource_id, [...(byResource.get(l.resource_id) ?? []), l.service_id]);
  return rows.map((r) => fromRow(r, byResource.get(r.id) ?? []));
}

async function getResource(session: Session, id: string): Promise<ResourceRecord> {
  const found = (await listResourcesAdmin(session)).find((r) => r.id === id);
  if (!found) throw new RepositoryNotFoundError("resources.get");
  return found;
}

/** Checks that every service exists in THIS workspace and may use a resource of `type`. Nothing is written. */
async function assertLinkable(client: SupabaseClient, session: Session, type: string, serviceIds: string[]): Promise<{ id: string; required: string | null }[]> {
  if (serviceIds.length === 0) return [];
  const { data, error } = await client.from("services").select("id,required_resource_type").eq("workspace_id", session.workspaceId).in("id", serviceIds);
  if (error) throw toRepositoryError(error, "resources.services");
  const rows = ((data as { id: string; required_resource_type: string | null }[]) ?? []).map((s) => ({ id: s.id, required: s.required_resource_type }));
  if (rows.length !== serviceIds.length) throw new RepositoryNotFoundError("resources.services");
  if (rows.some((s) => s.required !== null && s.required !== type)) throw new BusinessRuleError("service requires another resource type", "resource_type_mismatch");
  return rows;
}

async function stampRequiredType(client: SupabaseClient, session: Session, type: string, services: { id: string; required: string | null }[]): Promise<void> {
  const unset = services.filter((s) => s.required === null).map((s) => s.id);
  if (unset.length === 0) return;
  const { error } = await client.from("services").update({ required_resource_type: type }).eq("workspace_id", session.workspaceId).in("id", unset);
  if (error) throw toRepositoryError(error, "resources.requiredType");
}

export async function createResource(session: Session, input: CreateResourceInput): Promise<ResourceRecord> {
  assertCanWriteCatalog(session);
  const data = createResourceSchema.parse(input);
  const client = await createSupabaseServerClient();
  const services = await assertLinkable(client, session, data.type, data.serviceIds);
  const sortOrder = data.sortOrder ?? (await nextSortOrder(session, "resources"));
  const { data: row, error } = await client
    .from("resources")
    .insert({ workspace_id: session.workspaceId, name: data.name, type: data.type, description: data.description, sort_order: sortOrder, active: true })
    .select(COLUMNS)
    .single();
  if (error || !row) throw toRepositoryError(error, "resources.create");
  const created = row as Row;
  try {
    if (data.serviceIds.length > 0) {
      await syncLinks(client, "service_resources", "resource_id", created.id, data.serviceIds, "resources.links");
      await stampRequiredType(client, session, data.type, services);
    }
  } catch (e) {
    await client.from("resources").delete().eq("workspace_id", session.workspaceId).eq("id", created.id);
    throw e;
  }
  await audit(session, "created", "resource", created.id, `Resource added: ${data.name}`);
  return fromRow(created, data.serviceIds);
}

export async function updateResource(session: Session, id: string, input: UpdateResourceInput): Promise<ResourceRecord> {
  assertCanWriteCatalog(session);
  const patch = updateResourceSchema.parse(input);
  const before = await getResource(session, id);
  const client = await createSupabaseServerClient();
  const nextType = patch.type ?? before.type;
  const wanted = patch.serviceIds ?? before.serviceIds;
  if (nextType !== before.type && wanted.length > 0) throw new BusinessRuleError("unlink services before changing the type", "resource_type_mismatch");
  const added = wanted.filter((s) => !before.serviceIds.includes(s));
  const services = await assertLinkable(client, session, nextType, added);

  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.type !== undefined) row.type = patch.type;
  if (patch.description !== undefined) row.description = patch.description;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  if (Object.keys(row).length > 0) {
    const { data, error } = await client.from("resources").update(row).eq("workspace_id", session.workspaceId).eq("id", id).select("id").maybeSingle();
    if (error) throw toRepositoryError(error, "resources.update");
    if (!data) throw new RepositoryNotFoundError("resources.update");
  }
  if (patch.serviceIds) {
    await syncLinks(client, "service_resources", "resource_id", id, patch.serviceIds, "resources.links");
    await stampRequiredType(client, session, nextType, services);
  }
  await audit(session, "updated", "resource", id, `Resource updated: ${patch.name ?? before.name}`);
  return getResource(session, id);
}

export async function setResourceActive(session: Session, id: string, active: boolean): Promise<ResourceRecord> {
  assertCanWriteCatalog(session);
  const before = await getResource(session, id);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("resources").update({ active }).eq("workspace_id", session.workspaceId).eq("id", id).select("id").maybeSingle();
  if (error) throw toRepositoryError(error, "resources.setActive");
  if (!data) throw new RepositoryNotFoundError("resources.setActive");
  await audit(session, "updated", "resource", id, `Resource ${active ? "reactivated" : "deactivated"}: ${before.name}`);
  return getResource(session, id);
}
