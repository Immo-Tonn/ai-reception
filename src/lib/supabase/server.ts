import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Cookie-bound Supabase client for the CURRENT REQUEST/USER. Uses the
 * publishable (anon) key — respects Row Level Security, which is
 * deny-all for `anon`/`authenticated` on every table (see
 * supabase/migrations). This client is for Supabase Auth calls only
 * (signUp/signInWithPassword/getUser/signOut) — never query business
 * tables with it, they will simply return nothing. For business data,
 * use `createSupabaseAdminClient()` from `./admin` inside trusted
 * server code after `getSession()` has authorized the request.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
            // Called from a Server Component render (no response to attach
            // cookies to). Safe to ignore here — Server Actions and Route
            // Handlers are the paths that actually establish/refresh a
            // session, and those run with a mutable cookie store.
          }
        },
      },
    },
  );
}
