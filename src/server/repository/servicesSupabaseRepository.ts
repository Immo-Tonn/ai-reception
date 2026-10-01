import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Repository } from "@/lib/repository/types";
import type { ServiceDefinition } from "@/features/services/types";

/**
 * Real Supabase-backed Repository<ServiceDefinition> for real (non-demo)
 * workspaces — scoped by `workspace_id`, using the service_role admin
 * client (Вариант А: no RLS policies, all access goes through trusted
 * server code). Distinct from `mockRepository.ts`, which still backs the
 * four demo presets (salon/werkstatt/cleaning/consulting) — see
 * `registry.ts` for the branch between the two.
 *
 * `allowedStaffIds` isn't modeled yet (would need the `service_staff`
 * join table); every real-workspace service currently allows any staff
 * member. `translations` is demo-preset-only content, never persisted.
 */

interface ServiceRow {
  id: string;
  name: string;
  duration_minutes: number;
  price: number | string;
  currency: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  required_resource_type: string | null;
}

function fromRow(row: ServiceRow): ServiceDefinition {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    price: Number(row.price),
    currency: row.currency,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    allowedStaffIds: [],
    requiredResourceType: row.required_resource_type,
  };
}

const cache = new Map<string, Repository<ServiceDefinition>>();

export function getSupabaseServicesRepository(workspaceId: string): Repository<ServiceDefinition> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;

  const admin = createSupabaseAdminClient();

  const repo: Repository<ServiceDefinition> = {
    async list() {
      const { data, error } = await admin
        .from("services")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => fromRow(row as ServiceRow));
    },

    async get(id) {
      const { data, error } = await admin
        .from("services")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? fromRow(data as ServiceRow) : undefined;
    },

    async create(item) {
      const { data, error } = await admin
        .from("services")
        .insert({
          id: item.id,
          workspace_id: workspaceId,
          name: item.name,
          duration_minutes: item.durationMinutes,
          price: item.price,
          currency: item.currency,
          buffer_before_minutes: item.bufferBeforeMinutes,
          buffer_after_minutes: item.bufferAfterMinutes,
          required_resource_type: item.requiredResourceType,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return fromRow(data as ServiceRow);
    },

    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.durationMinutes !== undefined) row.duration_minutes = patch.durationMinutes;
      if (patch.price !== undefined) row.price = patch.price;
      if (patch.currency !== undefined) row.currency = patch.currency;
      if (patch.bufferBeforeMinutes !== undefined) row.buffer_before_minutes = patch.bufferBeforeMinutes;
      if (patch.bufferAfterMinutes !== undefined) row.buffer_after_minutes = patch.bufferAfterMinutes;
      if (patch.requiredResourceType !== undefined) row.required_resource_type = patch.requiredResourceType;

      const { data, error } = await admin
        .from("services")
        .update(row)
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? fromRow(data as ServiceRow) : undefined;
    },

    async remove(id) {
      const { error } = await admin
        .from("services")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async replaceAll(items) {
      await admin.from("services").delete().eq("workspace_id", workspaceId);
      if (items.length === 0) return;
      const rows = items.map((item) => ({
        id: item.id,
        workspace_id: workspaceId,
        name: item.name,
        duration_minutes: item.durationMinutes,
        price: item.price,
        currency: item.currency,
        buffer_before_minutes: item.bufferBeforeMinutes,
        buffer_after_minutes: item.bufferAfterMinutes,
        required_resource_type: item.requiredResourceType,
      }));
      const { error } = await admin.from("services").insert(rows);
      if (error) throw new Error(error.message);
    },
  };

  cache.set(workspaceId, repo);
  return repo;
}
