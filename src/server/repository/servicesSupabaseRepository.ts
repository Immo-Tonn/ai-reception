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
 * `allowedStaffIds` is backed by the `service_staff` join table: an empty
 * list means "every specialist can perform this service". `translations`
 * is demo-preset-only content, never persisted.
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

function fromRow(row: ServiceRow, allowedStaffIds: string[]): ServiceDefinition {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    price: Number(row.price),
    currency: row.currency,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    allowedStaffIds,
    requiredResourceType: row.required_resource_type,
  };
}

const cache = new Map<string, Repository<ServiceDefinition>>();

export function getSupabaseServicesRepository(workspaceId: string): Repository<ServiceDefinition> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;

  const admin = createSupabaseAdminClient();

  async function loadAllowed(serviceIds: string[]): Promise<Map<string, string[]>> {
    const allowed = new Map<string, string[]>();
    if (serviceIds.length === 0) return allowed;
    const { data, error } = await admin
      .from("service_staff")
      .select("service_id, staff_id")
      .in("service_id", serviceIds);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as { service_id: string; staff_id: string }[]) {
      const list = allowed.get(row.service_id) ?? [];
      list.push(row.staff_id);
      allowed.set(row.service_id, list);
    }
    return allowed;
  }

  async function setAllowed(serviceId: string, staffIds: string[]): Promise<void> {
    const { error: deleteError } = await admin
      .from("service_staff")
      .delete()
      .eq("service_id", serviceId);
    if (deleteError) throw new Error(deleteError.message);
    if (staffIds.length === 0) return;
    const { error } = await admin
      .from("service_staff")
      .insert(staffIds.map((staffId) => ({ service_id: serviceId, staff_id: staffId })));
    if (error) throw new Error(error.message);
  }

  const repo: Repository<ServiceDefinition> = {
    async list() {
      const { data, error } = await admin
        .from("services")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("active", true)
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as ServiceRow[];
      const allowed = await loadAllowed(rows.map((row) => row.id));
      return rows.map((row) => fromRow(row, allowed.get(row.id) ?? []));
    },

    async get(id) {
      const { data, error } = await admin
        .from("services")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return undefined;
      const allowed = await loadAllowed([id]);
      return fromRow(data as ServiceRow, allowed.get(id) ?? []);
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
      const created = data as ServiceRow;
      await setAllowed(created.id, item.allowedStaffIds);
      return fromRow(created, item.allowedStaffIds);
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

      if (Object.keys(row).length > 0) {
        const { error } = await admin
          .from("services")
          .update(row)
          .eq("workspace_id", workspaceId)
          .eq("id", id);
        if (error) throw new Error(error.message);
      }
      if (patch.allowedStaffIds !== undefined) {
        await setAllowed(id, patch.allowedStaffIds);
      }
      return this.get(id);
    },

    async remove(id) {
      // Soft delete: appointments keep a valid `service_id` for history,
      // and the service simply stops being offered for new bookings.
      const { error } = await admin
        .from("services")
        .update({ active: false })
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
