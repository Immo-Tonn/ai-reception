import type { GoogleErrorCode } from "@/lib/auth/googleLogin";

/**
 * Google sign-in logic against the minimal Supabase Auth surface it needs, so it can be
 * tested with a fake. No cookies, no env: the thin wrapper in `googleSignIn.ts` supplies the
 * real request-scoped client.
 */
export interface GoogleAuthClient {
  auth: {
    signInWithOAuth(args: {
      provider: "google";
      options: { redirectTo: string; skipBrowserRedirect: boolean; queryParams?: Record<string, string> };
    }): Promise<{ data: { url: string | null } | null; error: { message?: string } | null }>;
    exchangeCodeForSession(code: string): Promise<{
      data: { user: GoogleAuthUser | null } | null;
      error: { message?: string; status?: number } | null;
    }>;
    signOut(): Promise<unknown>;
  };
}

export interface GoogleAuthUser {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  identities?: { provider?: string }[] | null;
}

/**
 * `signInWithOAuth` with `skipBrowserRedirect` only BUILDS the authorize URL locally: it does not
 * tell whether the Google provider is switched on in Supabase. The authorize endpoint does — it
 * answers a redirect to Google when the provider works and an error otherwise. This one request
 * (no redirect followed, nothing stored) keeps a not-yet-configured provider from sending the
 * person to a raw error page.
 */
export type AuthorizeProbe = (url: string) => Promise<"ok" | "unavailable">;

export const GOOGLE_AUTH_HOST = "accounts.google.com";

export async function probeAuthorizeUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<"ok" | "unavailable"> {
  const res = await fetchImpl(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(5000) });
  const location = res.headers.get("location");
  if (res.status < 300 || res.status >= 400 || !location) return "unavailable";
  try {
    return new URL(location).hostname === GOOGLE_AUTH_HOST ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export type StartResult = { ok: true; url: string } | { ok: false; code: GoogleErrorCode };
export type FinishResult = { ok: true; userId: string; email: string } | { ok: false; code: GoogleErrorCode };

/**
 * Asks Supabase for the Google authorize URL (PKCE: the verifier is stored in the request's
 * cookies by the Supabase client). The URL must point at the configured Supabase project —
 * nothing else is ever followed.
 */
export async function startGoogleOAuth(
  client: GoogleAuthClient,
  redirectTo: string,
  supabaseUrl: string,
  probe: AuthorizeProbe = probeAuthorizeUrl,
): Promise<StartResult> {
  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
    // A provider that is switched off in the dashboard answers with an error: not configured yet.
    if (error || !data?.url) return { ok: false, code: "google_unavailable" };
    const target = new URL(data.url);
    if (target.origin !== new URL(supabaseUrl).origin) return { ok: false, code: "google_failed" };
    if ((await probe(target.toString())) !== "ok") return { ok: false, code: "google_unavailable" };
    return { ok: true, url: target.toString() };
  } catch {
    return { ok: false, code: "google_failed" };
  }
}

/**
 * Exchanges the one-time code for a session and accepts only a Google identity with a
 * verified e-mail. Anything else is signed out again, so no half-trusted session is left.
 */
export async function finishGoogleOAuth(client: GoogleAuthClient, code: string): Promise<FinishResult> {
  if (!code || code.length > 2048) return { ok: false, code: "google_failed" };
  try {
    const { data, error } = await client.auth.exchangeCodeForSession(code);
    const user = data?.user;
    if (error || !user) return { ok: false, code: "google_failed" };
    const viaGoogle = (user.identities ?? []).some((i) => i.provider === "google");
    if (!viaGoogle || !user.email || !user.email_confirmed_at) {
      await client.auth.signOut();
      return { ok: false, code: "google_unverified" };
    }
    return { ok: true, userId: user.id, email: user.email.trim().toLowerCase() };
  } catch {
    return { ok: false, code: "google_failed" };
  }
}
