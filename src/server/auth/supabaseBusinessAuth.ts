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

/**
 * Changes the signed-in user's password. The CURRENT password is verified
 * first (re-authentication through the user's own session — no service role),
 * then the new one is set and every OTHER session of this user is ended; the
 * current browser stays signed in. Failures are stable codes, never raw messages.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; code: AuthErrorCode }> {
  if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };
  const supabase = await createSupabaseServerClient();
  const { data, error: userError } = await supabase.auth.getUser();
  const email = data.user?.email;
  if (userError || !email) return { ok: false, code: "unknown" };

  const verified = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (verified.error) return { ok: false, code: mapSupabaseAuthError(verified.error) };

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { ok: false, code: mapSupabaseAuthError(error) };

  // Best effort: the password is already changed even if ending other sessions fails.
  await supabase.auth.signOut({ scope: "others" }).catch(() => undefined);
  return { ok: true };
}

/**
 * Password recovery by one-time code (Supabase `recovery` OTP). The current
 * password keeps working until a new one is set; nothing here uses the
 * service role.
 *
 * Asking for a code answers the same way whether or not the address has an
 * account: only a rate limit is reported, every other failure (unknown
 * address, mail transport) looks like success and is logged by code only.
 */
export async function requestPasswordResetCode(
  email: string,
): Promise<{ ok: true } | { ok: false; code: AuthErrorCode }> {
  if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (!error) return { ok: true };
  const code = mapSupabaseAuthError(error);
  if (code === "rate_limited") return { ok: false, code };
  console.error("[password-reset] request failed:", error.code ?? error.status ?? "unknown");
  return { ok: true };
}

/** Checks the e-mailed code; a correct one opens a session for that user. */
export async function verifyPasswordResetCode(
  email: string,
  code: string,
): Promise<{ ok: true } | { ok: false; code: AuthErrorCode | "invalid_code" }> {
  if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });
  if (error) {
    if (mapSupabaseAuthError(error) === "rate_limited") return { ok: false, code: "rate_limited" };
    if ((error.status ?? 400) >= 500) return { ok: false, code: "unknown" };
    return { ok: false, code: "invalid_code" }; // wrong or expired: one answer for both
  }
  if (!data.session) return { ok: false, code: "invalid_code" };
  return { ok: true };
}

/** Sets the new password for the signed-in (recovery) session, then ends ALL sessions: the person signs in again. */
export async function completePasswordReset(
  newPassword: string,
): Promise<{ ok: true } | { ok: false; code: AuthErrorCode | "same_password" }> {
  if (!isSupabaseConfigured()) return { ok: false, code: "not_configured" };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    if (error.code === "same_password") return { ok: false, code: "same_password" };
    return { ok: false, code: mapSupabaseAuthError(error) };
  }
  // Best effort: the password is already changed even if ending the sessions fails.
  await supabase.auth.signOut({ scope: "global" }).catch(() => undefined);
  return { ok: true };
}

export function getBusinessAuth(): BusinessAuthProvider {
  return supabaseBusinessAuth;
}
