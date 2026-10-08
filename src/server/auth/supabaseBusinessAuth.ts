import "server-only";
import type { AuthError } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { AuthErrorCode, BusinessAuthProvider } from "./businessAuth";

/** Maps a Supabase Auth error to a stable code. The raw message is dropped on purpose. */
export function mapSupabaseAuthError(error: Pick<AuthError, "code" | "status"> | null | undefined): AuthErrorCode {
  const code = error?.code ?? "";
  if (code === "invalid_credentials" || code === "invalid_login_credentials") return "invalid_credentials";
  if (code === "user_already_exists" || code === "email_exists") return "email_taken";
  if (code === "weak_password") return "weak_password";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error?.status === 429) {
    return "rate_limited";
  }
  if (code === "validation_failed" || code === "email_address_invalid") return "invalid_input";
  return "unknown";
}

export const supabaseBusinessAuth: BusinessAuthProvider = {
  async signUpWithPassword(email, password) {
    if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { ok: false, code: mapSupabaseAuthError(error) };
    // With e-mail confirmation on, an existing address comes back as a user
    // with no identities instead of an error.
    if (!data.user || (data.user.identities && data.user.identities.length === 0)) {
      return { ok: false, code: "email_taken" };
    }
    return { ok: true, userId: data.user.id, hasSession: Boolean(data.session) };
  },

  async signInWithPassword(email, password) {
    if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { ok: false, code: mapSupabaseAuthError(error) };
    return { ok: true, userId: data.user.id };
  },

  async signOut() {
    if (!isSupabaseConfigured()) return;
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  },

  async getCurrentUserId() {
    if (!isSupabaseConfigured()) return null;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    return error || !data.user ? null : data.user.id;
  },

  async discardUser(userId) {
    try {
      await createSupabaseAdminClient().auth.admin.deleteUser(userId);
    } catch {
      // Best effort: a failed rollback must not mask the original error.
    }
  },
};

/** Verified signed-in user (id + e-mail) or null. Never throws (anonymous, unconfigured, cookies unavailable). */
export async function getCurrentUserSafe(): Promise<{ id: string; email: string | null } | null> {
  try {
    if (!isSupabaseConfigured()) return null;
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    return error || !data.user ? null : { id: data.user.id, email: data.user.email ?? null };
  } catch {
    return null;
  }
}

export function getBusinessAuth(): BusinessAuthProvider {
  return supabaseBusinessAuth;
}
