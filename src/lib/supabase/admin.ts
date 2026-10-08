import "server-only";
import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "./config";

/**
 * SERVICE-ROLE client — bypasses Row Level Security completely. It is NOT a
 * replacement for RLS and must not be used for ordinary authenticated
 * business CRUD (use `createSupabaseServerClient` so the database enforces
 * tenant isolation).
 *
 * Allowed uses, and only from trusted server code that has validated its
 * own input:
 *   1. Guest actions that have no user session (public booking).
 *   2. Provisioning a new workspace (`provision_workspace`).
 *   3. Auth admin operations (rolling back a half-created sign-up).
 *
 * `src/server/db/__tests__/secrets.test.ts` pins the list of files that may
 * import this module. The key is read from a server-only variable and is
 * never exposed to the browser (no NEXT_PUBLIC_ prefix, `server-only`).
 */
export class SupabaseAdminNotConfiguredError extends Error {
  constructor() {
    super("Supabase admin access is not configured (SUPABASE_SERVICE_ROLE_KEY).");
    this.name = "SupabaseAdminNotConfiguredError";
  }
}

let cached: { key: string; client: SupabaseClient } | null = null;

export function createSupabaseAdminClient(): SupabaseClient {
  const { url } = requireSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new SupabaseAdminNotConfiguredError();

  if (!cached || cached.key !== serviceRoleKey) {
    cached = {
      key: serviceRoleKey,
      client: createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      }),
    };
  }
  return cached.client;
}

/**
 * A server-only secret DERIVED from the service-role key (HMAC-SHA256 with a
 * purpose label), for things like keyed hashing of rate-limit subjects. It
 * keeps the raw key confined to this file and needs no extra ENV variable.
 */
export function deriveServerSecret(purpose: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new SupabaseAdminNotConfiguredError();
  return createHmac("sha256", key).update(`serviceos:${purpose}`).digest("hex");
}
