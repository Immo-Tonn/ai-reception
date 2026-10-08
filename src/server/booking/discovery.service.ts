import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getDiscoveryDeps } from "./deps";

/**
 * Client Discovery: the public directory of businesses that explicitly opted
 * in (`discoverable` AND `public_booking_enabled`). The opt-in filter lives in
 * the service-role-only RPC of migration 0017; this module only clamps paging,
 * maps rows to a small public DTO and degrades to an empty list on failure.
 * Pure of the admin client: it receives `deps.admin` like publicBooking.service.
 */

export interface DiscoveryDeps {
  admin: SupabaseClient;
}

/** Everything the directory card needs — no ids, no contact data, no logo reference. */
export interface DiscoverableBusiness {
  slug: string;
  name: string;
  city: string;
  country: string;
  description: string;
}

export const DISCOVERY_DEFAULT_LIMIT = 24;
export const DISCOVERY_MAX_LIMIT = 50;

export function clampDiscoveryPaging(limit?: number, offset?: number): { limit: number; offset: number } {
  const l = Number.isFinite(limit) ? Math.trunc(limit as number) : DISCOVERY_DEFAULT_LIMIT;
  const o = Number.isFinite(offset) ? Math.trunc(offset as number) : 0;
  return { limit: Math.min(Math.max(l, 1), DISCOVERY_MAX_LIMIT), offset: Math.max(o, 0) };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function mapDiscoverableRow(row: unknown): DiscoverableBusiness | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const slug = str(r.slug);
  const name = str(r.name).trim();
  if (!slug || !name) return null;
  // `logo_path` and `industry` are deliberately dropped (logo upload is a future feature).
  return { slug, name, city: str(r.city), country: str(r.country), description: str(r.description) };
}

/** Never throws: any RPC failure yields an empty directory. */
export async function listDiscoverableBusinesses(
  deps: DiscoveryDeps,
  opts: { limit?: number; offset?: number } = {},
): Promise<DiscoverableBusiness[]> {
  const { limit, offset } = clampDiscoveryPaging(opts.limit, opts.offset);
  try {
    const { data, error } = await deps.admin.rpc("list_discoverable_businesses", { p_limit: limit, p_offset: offset });
    if (error || !Array.isArray(data)) return [];
    return data.map(mapDiscoverableRow).filter((b): b is DiscoverableBusiness => b !== null);
  } catch {
    return [];
  }
}

/** Production entry for the page: empty when Supabase / the service role is not configured. */
export async function loadDiscoverableBusinesses(opts: { limit?: number; offset?: number } = {}): Promise<DiscoverableBusiness[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    return await listDiscoverableBusinesses(getDiscoveryDeps(), opts);
  } catch {
    return [];
  }
}
