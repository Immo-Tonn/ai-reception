import { NextResponse, type NextRequest } from "next/server";
import { getPublicBaseUrl } from "@/lib/config/publicBaseUrl";
import {
  GOOGLE_CONTEXT_COOKIE,
  googleFailureHref,
  googleLandingPath,
  isGoogleLoginEnabled,
  parseGoogleContext,
  type GoogleErrorCode,
} from "@/lib/auth/googleLogin";
import { finishGoogleSignIn } from "@/server/auth/googleSignIn";
import { findOwnerHomeSlug } from "@/server/auth/ownerHome";

export const dynamic = "force-dynamic";

/**
 * Return address of "Continue with Google" (Supabase redirects here with a one-time `code`).
 * Exchanges the code for a session, accepts only a Google identity with a verified e-mail and
 * sends the person on. Every failure is a redirect to the sign-in page with a stable code —
 * no provider message, token or error text is ever echoed. Where to go next comes only from
 * the httpOnly cookie set by the entry action, validated again here.
 */
export async function GET(request: NextRequest) {
  const ctx = parseGoogleContext(request.cookies.get(GOOGLE_CONTEXT_COOKIE)?.value) ?? { intent: "owner" as const, next: "" };
  const base = getPublicBaseUrl(request.headers.get("host")).baseUrl ?? request.nextUrl.origin;
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, base), 303);
    response.cookies.set(GOOGLE_CONTEXT_COOKIE, "", { path: "/", maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  const fail = (code: GoogleErrorCode) => go(googleFailureHref(ctx.intent, code, ctx.next));

  if (!isGoogleLoginEnabled()) return fail("google_unavailable");

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "google_cancelled" : "google_failed");
  const code = params.get("code");
  if (!code) return fail("google_failed");

  const result = await finishGoogleSignIn(code);
  if (!result.ok) return fail(result.code);

  const homeSlug = ctx.intent === "owner" && result.supabase ? await findOwnerHomeSlug(result.supabase, result.userId) : null;
  return go(googleLandingPath(ctx, homeSlug));
}
