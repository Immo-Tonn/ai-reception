import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, requireSupabaseConfig } from "@/lib/supabase/config";
import { finishGoogleOAuth, startGoogleOAuth, type FinishResult, type GoogleAuthClient, type StartResult } from "./googleSignInCore";

/** Request-scoped wrappers: the real Supabase client (cookies carry the PKCE verifier and the session). */
export async function startGoogleSignIn(redirectTo: string): Promise<StartResult> {
  if (!isSupabaseConfigured()) return { ok: false, code: "google_unavailable" };
  const supabase = await createSupabaseServerClient();
  return startGoogleOAuth(supabase as unknown as GoogleAuthClient, redirectTo, requireSupabaseConfig().url);
}

export async function finishGoogleSignIn(code: string): Promise<(FinishResult & { supabase?: SupabaseClient }) | { ok: false; code: "google_unavailable" }> {
  if (!isSupabaseConfigured()) return { ok: false, code: "google_unavailable" };
  const supabase = await createSupabaseServerClient();
  const result = await finishGoogleOAuth(supabase as unknown as GoogleAuthClient, code);
  return result.ok ? { ...result, supabase } : result;
}
