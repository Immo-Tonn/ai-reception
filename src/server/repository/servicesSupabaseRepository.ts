import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Repository } from "@/lib/repository/types";
import type { ServiceDefinition } from "@/features/services/types";
import { serviceFromRow, serviceToRow, type ServiceRow } from "./servicesMapper";

/**
 * Supabase adapter for `Repository<ServiceDefinition>` — the real-workspace
 * counterpart of the in-memory mock. Provider-specific code stays in this
 * file; callers only know the Repository interface.
 *
 * It runs as the SIGNED-IN USER (anon key + session cookie), so Row Level
 * Security (`services_*` policies, migration 0009) is what actually
 * enforces tenant isolation and `settings.manage`; the `.eq("workspace_id")`
 * filters below are a second line of defense and keep queries index-friendly.
 * No service-role key is involved.
 *
 * `allowedStaffIds` is read from `service_staff` (separate query); writing it is not offered
 * yet (no UI sets it). `replaceAll` is deliberately unsupported: the old
 * delete-then-insert approach is non-atomic and destructive.
 */
const SELECT = "*";

/** `service_staff` links for the given services (a separate query keeps the adapter simple and portable). */
async function withStaffLinks(client: SupabaseClient, rows: ServiceRow[]): Promise<ServiceRow[]> {
  if (rows.length === 0) return rows;
  const { data, error } = await client.from("service_staff").select("service_id,staff_id").in("service_id", rows.map((r) => r.id));
  if (error) throw new Error("services.staff failed");
  const links = (data as { service_id: string; staff_id: string }[]) ?? [];
  return rows.map((r) => ({ ...r, service_staff: links.filter((l) => l.service_id === r.id).map((l) => ({ staff_id: l.staff_id })) }));
}

export function createSupabaseServicesRepository(
  workspaceId: string,
  getClient: () => Promise<SupabaseClient> = createSupabaseServerClient,
): Repository<ServiceDefinition> {
  return {
    async list() {
      const client = await getClient();
      const { data, error } = await client
        .from("services")
        .select(SELECT)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });
      if (error) throw new Error("services.list failed");
      return (await withStaffLinks(client, (data ?? []) as ServiceRow[])).map(serviceFromRow);
    },

    async get(id) {
      const client = await getClient();
      const { data, error } = await client
        .from("services")
        .select(SELECT)
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error("services.get failed");
      return data ? serviceFromRow((await withStaffLinks(client, [data as ServiceRow]))[0]) : undefined;
    },

    async create(item) {
      const client = await getClient();
      const { data, error } = await client
        .from("services")
        .insert({ id: item.id, workspace_id: workspaceId, ...serviceToRow(item) })
        .select(SELECT)
        .single();
      if (error || !data) throw new Error("services.create failed");
      return serviceFromRow((await withStaffLinks(client, [data as ServiceRow]))[0]);
    },

    async update(id, patch) {
      const client = await getClient();
      const { data, error } = await client
        .from("services")
        .update(serviceToRow(patch))
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .select(SELECT)
        .maybeSingle();
      if (error) throw new Error("services.update failed");
      return data ? serviceFromRow((await withStaffLinks(client, [data as ServiceRow]))[0]) : undefined;
    },

    async remove(id) {
      const client = await getClient();
      const { error } = await client.from("services").delete().eq("workspace_id", workspaceId).eq("id", id);
      if (error) throw new Error("services.remove failed");
    },

    async replaceAll() {
      throw new Error("services.replaceAll is not supported (non-atomic and destructive)");
    },
  };
}
