"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicBaseUrl } from "@/lib/config/publicBaseUrl";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_CONTEXT_COOKIE,
  GOOGLE_CONTEXT_MAX_AGE_SECONDS,
  buildGoogleContext,
  encodeGoogleContext,
  googleFailureHref,
  isGoogleLoginEnabled,
  parseGoogleIntent,
} from "@/lib/auth/googleLogin";
import { authAttemptAllowed } from "@/server/auth/authRateLimit";
import { startGoogleSignIn } from "@/server/auth/googleSignIn";

/**
 * Entry point of "Continue with Google" (business and client forms post here). Refuses while
 * the feature is off, keeps brute-force/abuse limits, builds the callback address from the
 * configured public base URL (never from request data) and remembers where the person was
 * going in a short-lived httpOnly cookie. The actual authorization happens at Google and
 * Supabase; this app never sees a Google token or key.
 */
export async function startGoogleSignInAction(formData: FormData): Promise<void> {
  const intent = parseGoogleIntent(formData.get("intent"));
  const ctx = buildGoogleContext(intent, formData.get("next"));
  const failure = (code: Parameters<typeof googleFailureHref>[1]) => googleFailureHref(intent, code, ctx.next);

  if (!isGoogleLoginEnabled()) redirect(failure("google_unavailable"));
  if (!(await authAttemptAllowed({ kind: "google_start" }))) redirect(failure("rate_limited"));

  const host = (await headers()).get("host");
  const { baseUrl } = getPublicBaseUrl(host);
  if (!baseUrl) redirect(failure("google_unavailable"));

  const started = await startGoogleSignIn(`${baseUrl}${GOOGLE_CALLBACK_PATH}`);
  if (!started.ok) redirect(failure(started.code));

  (await cookies()).set(GOOGLE_CONTEXT_COOKIE, encodeGoogleContext(ctx), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GOOGLE_CONTEXT_MAX_AGE_SECONDS,
  });
  redirect(started.url);
}
