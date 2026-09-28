import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * `service_role`-keyed client — bypasses Row Level Security entirely.
 * This is the ONLY client that may read/write business tables (profiles,
 * workspaces, appointments, ...) under the current RLS setup (deny-all
 * for anon/authenticated — see supabase/migrations + Этап 0 decision:
 * "Track A/B — server actions only").
 *
 * Import this ONLY from trusted server-only code (Server Actions, Route
 * Handlers, Server Components, application services). Never forward this
 * client or its key to the browser. Every caller MUST have already
 * authorized the request itself (e.g. via `getSession()`) — this client
 * enforces nothing on its own.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  if (!cached) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
      throw new Error(
        "Supabase admin client: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing.",
      );
    }
    cached = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cached;
}
