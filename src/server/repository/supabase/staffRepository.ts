import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Repository } from "@/lib/repository/types";
import type { StaffMember } from "@/features/staff/types";
import { getWorkspaceInfo } from "./workspaceInfo";

/**
 * Real Supabase-backed Repository<StaffMember> ("specialists") for real
 * workspaces. Removal is a soft delete (`active = false`): past
 * appointments keep pointing at the specialist so history never loses a
 * name, while the (partial-unique) name becomes free again.
 *
 * Invariant: a workspace that takes online bookings needs at least one
 * bookable specialist. `list()` self-heals an empty workspace by creating
 * one default specialist named after the business — so a one-person
 * business works out of the box and the owner can rename/add later.
 */

interface StaffRow {
  id: string;
  name: string;
  color_token: string;
}

const DEFAULT_COLOR = "--color-accent-blue";

function fromRow(row: StaffRow): StaffMember {
  return { id: row.id, name: row.name, colorToken: row.color_token };
}

const cache = new Map<string, Repository<StaffMember>>();

export function getSupabaseStaffRepository(workspaceId: string): Repository<StaffMember> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;

  const admin = createSupabaseAdminClient();

  async function fetchActive(): Promise<StaffMember[]> {
    const { data, error } = await admin
      .from("staff_profiles")
      .select("id, name, color_token")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => fromRow(row as StaffRow));
  }

  const repo: Repository<StaffMember> = {
    async list() {
      const active = await fetchActive();
      if (active.length > 0) return active;

      // Self-heal: create the default specialist (idempotent on races —
      // the partial unique index rejects a duplicate name, in which case
      // we simply re-read).
      const info = await getWorkspaceInfo(workspaceId);
      const { error } = await admin.from("staff_profiles").insert({
        workspace_id: workspaceId,
        name: info.name,
        color_token: DEFAULT_COLOR,
      });
      if (error && error.code !== "23505") throw new Error(error.message);
      return fetchActive();
    },

    async get(id) {
      const { data, error } = await admin
        .from("staff_profiles")
        .select("id, name, color_token")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? fromRow(data as StaffRow) : undefined;
    },

    async create(item) {
      const { data, error } = await admin
        .from("staff_profiles")
        .insert({
          workspace_id: workspaceId,
          name: item.name,
          color_token: item.colorToken || DEFAULT_COLOR,
        })
        .select("id, name, color_token")
        .single();
      if (error) {
        if (error.code === "23505") {
          throw new Error("A specialist with this name already exists.");
        }
        throw new Error(error.message);
      }
      return fromRow(data as StaffRow);
    },

    async update(id, patch) {
      const row: Record<string, unknown> = {};
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.colorToken !== undefined) row.color_token = patch.colorToken;
      const { data, error } = await admin
        .from("staff_profiles")
        .update(row)
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .select("id, name, color_token")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") {
          throw new Error("A specialist with this name already exists.");
        }
        throw new Error(error.message);
      }
      return data ? fromRow(data as StaffRow) : undefined;
    },

    async remove(id) {
      const { error } = await admin
        .from("staff_profiles")
        .update({ active: false })
        .eq("workspace_id", workspaceId)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async replaceAll() {
      throw new Error("replaceAll is not supported for specialists.");
    },
  };

  cache.set(workspaceId, repo);
  return repo;
}
