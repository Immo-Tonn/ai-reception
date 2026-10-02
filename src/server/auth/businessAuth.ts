/**
 * Provider-independent Business Auth contract. The rest of the app (server
 * actions, provisioning) depends on THIS interface, never on Supabase — the
 * Supabase implementation lives in `supabaseBusinessAuth.ts`. Adding Google /
 * Apple / Microsoft later means new methods + another adapter; callers keep
 * working. (Those providers are NOT implemented now.)
 *
 * Failures are returned as stable CODES, never raw provider messages: the UI
 * maps codes to localized text, and nothing from the auth provider's error
 * body reaches the browser.
 */
export type AuthErrorCode =
  | "invalid_input"
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "rate_limited"
  | "not_configured"
  | "unknown";

export type AuthResult<T> = ({ ok: true } & T) | { ok: false; code: AuthErrorCode };

export interface BusinessAuthProvider {
  /**
   * `hasSession` is false when the provider requires e-mail confirmation before
   * the user can sign in (the normal production setup).
   */
  signUpWithPassword(email: string, password: string): Promise<AuthResult<{ userId: string; hasSession: boolean }>>;
  signInWithPassword(email: string, password: string): Promise<AuthResult<{ userId: string }>>;
  signOut(): Promise<void>;
  /** Verified id of the signed-in user, or `null`. */
  getCurrentUserId(): Promise<string | null>;
  /** Removes a user created by a sign-up whose provisioning then failed. Never throws. */
  discardUser(userId: string): Promise<void>;
}
