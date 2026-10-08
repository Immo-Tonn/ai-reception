import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Repository } from "@/lib/repository/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition, ResourceType } from "@/features/resources/types";
import type { AuditLogEntry } from "@/features/auditLog/types";
import { isUuid } from "./appointmentsMapper";
import { RepositoryError, toRepositoryError } from "./errors";

type ClientFactory = () => Promise<SupabaseClient>;

/** Staff (`staff_profiles`). "Removing" a person deactivates them: appointments keep their reference. */
export function createSupabaseStaffRepository(workspaceId: string, getClient: ClientFactory = createSupabaseServerClient): Repository<StaffMember> {
  const fromRow = (r: { id: string; name: string; color_token: string }): StaffMember => ({ id: r.id, name: r.name, colorToken: r.color_token });
  return {
    async list() {
      const client = await getClient();
      const { data, error } = await client.from("staff_profiles").select("*").eq("workspace_id", workspaceId).eq("active", true).order("created_at", { ascending: true });
      if (error) throw toRepositoryError(error, "staff.list");
      return (data ?? []).map((r) => fromRow(r as never));
    },
    async get(id) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const { data, error } = await client.from("staff_profiles").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (error) throw toRepositoryError(error, "staff.get");
      return data ? fromRow(data as never) : undefined;
    },
    async create(item) {
      const client = await getClient();
      const { data, error } = await client.from("staff_profiles").insert({ workspace_id: workspaceId, name: item.name, color_token: item.colorToken }).select("*").single();
      if (error || !data) throw toRepositoryError(error, "staff.create");
      return fromRow(data as never);
    },
    async update(id, patch) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.colorToken !== undefined) row.color_token = patch.colorToken;
      if (Object.keys(row).length === 0) return this.get(id);
      const { data, error } = await client.from("staff_profiles").update(row).eq("workspace_id", workspaceId).eq("id", id).select("*").maybeSingle();
      if (error) throw toRepositoryError(error, "staff.update");
      return data ? fromRow(data as never) : undefined;
    },
    async remove(id) {
      if (!isUuid(id)) return;
      const client = await getClient();
      const { error } = await client.from("staff_profiles").update({ active: false }).eq("workspace_id", workspaceId).eq("id", id);
      if (error) throw toRepositoryError(error, "staff.remove");
    },
    async replaceAll() {
      throw new RepositoryError("staff.replaceAll is not supported");
    },
  };
}

/** Resources (`resources`). Types are the database enum: room / vehicle / equipment / custom. */
export function createSupabaseResourcesRepository(workspaceId: string, getClient: ClientFactory = createSupabaseServerClient): Repository<ResourceDefinition> {
  const fromRow = (r: { id: string; name: string; type: string }): ResourceDefinition => ({ id: r.id, name: r.name, type: r.type as ResourceType });
  return {
    async list() {
      const client = await getClient();
      const { data, error } = await client.from("resources").select("*").eq("workspace_id", workspaceId).eq("active", true).order("created_at", { ascending: true });
      if (error) throw toRepositoryError(error, "resources.list");
      return (data ?? []).map((r) => fromRow(r as never));
    },
    async get(id) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const { data, error } = await client.from("resources").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (error) throw toRepositoryError(error, "resources.get");
      return data ? fromRow(data as never) : undefined;
    },
    async create(item) {
      const client = await getClient();
      const { data, error } = await client.from("resources").insert({ workspace_id: workspaceId, name: item.name, type: item.type }).select("*").single();
      if (error || !data) throw toRepositoryError(error, "resources.create");
      return fromRow(data as never);
    },
    async update(id, patch) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.type !== undefined) row.type = patch.type;
      if (Object.keys(row).length === 0) return this.get(id);
      const { data, error } = await client.from("resources").update(row).eq("workspace_id", workspaceId).eq("id", id).select("*").maybeSingle();
      if (error) throw toRepositoryError(error, "resources.update");
      return data ? fromRow(data as never) : undefined;
    },
    async remove(id) {
      if (!isUuid(id)) return;
      const client = await getClient();
      const { error } = await client.from("resources").update({ active: false }).eq("workspace_id", workspaceId).eq("id", id);
      if (error) throw toRepositoryError(error, "resources.remove");
    },
    async replaceAll() {
      throw new RepositoryError("resources.replaceAll is not supported");
    },
  };
}

const ACTION_OK = new Set(["created", "updated", "moved", "statusChanged", "cancelled", "deleted"]);

/** Audit log (`audit_logs`). Append-mostly: entries are written by members as `source = user`. No secrets or PII in `summary`. */
export function createSupabaseAuditLogRepository(workspaceId: string, getClient: ClientFactory = createSupabaseServerClient): Repository<AuditLogEntry> {
  const fromRow = (r: { id: string; created_at: string; action: string; entity_type: string; entity_id: string; summary: string; source: string }): AuditLogEntry => ({
    id: r.id,
    timestamp: r.created_at,
    action: (ACTION_OK.has(r.action) ? r.action : "updated") as AuditLogEntry["action"],
    entityType: r.entity_type as AuditLogEntry["entityType"],
    entityId: r.entity_id,
    summary: r.summary,
    source: r.source as AuditLogEntry["source"],
  });
  return {
    async list() {
      const client = await getClient();
      const { data, error } = await client.from("audit_logs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500);
      if (error) throw toRepositoryError(error, "auditLog.list");
      return (data ?? []).map((r) => fromRow(r as never));
    },
    async get() {
      return undefined;
    },
    async create(item) {
      const client = await getClient();
      const { data: u } = await client.auth.getUser();
      const { error } = await client.from("audit_logs").insert({
        workspace_id: workspaceId,
        actor_id: u.user?.id ?? null,
        action: item.action,
        entity_type: item.entityType,
        entity_id: item.entityId,
        summary: item.summary.slice(0, 500),
        source: "user",
      });
      if (error) throw toRepositoryError(error, "auditLog.create");
      return item;
    },
    async update() {
      throw new RepositoryError("auditLog entries are immutable");
    },
    async remove() {
      throw new RepositoryError("auditLog entries are immutable");
    },
    async replaceAll() {
      throw new RepositoryError("auditLog.replaceAll is not supported");
    },
  };
}
