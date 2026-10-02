import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "./config";

/**
 * Request-scoped Supabase client acting AS THE SIGNED-IN USER (anon key +
 * the user's session cookie). Every query it makes runs under Row Level
 * Security with the user's identity — this is the client for all ordinary
 * authenticated business reads/writes and for Auth calls. Create one per
 * request; never cache it across requests.
 *
 * It cannot do anything the user is not allowed to do; that is the point.
 * For the few operations that must exceed a user's rights (guest booking,
 * provisioning, Auth admin) see `./admin`.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = requireSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render: cookies are read-only
          // there. `src/proxy.ts` refreshes the session cookie instead.
        }
      },
    },
  });
}
