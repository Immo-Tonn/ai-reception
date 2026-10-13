import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders } from "@/server/ratelimit/rateLimiter";
import { getExternalCalendarDeps, googleRedirectUri } from "@/server/externalCalendar/deps";
import { FLOW_COOKIE, MANAGE_COOKIE, SETUP_COOKIE, completeOAuthCallback } from "@/server/externalCalendar/service";
import { cookieOptions, limitConnectAttempts, RateLimitedError, toConnectError } from "@/server/externalCalendar/http";

export const dynamic = "force-dynamic";

/**
 * Google OAuth redirect target for both flows (connect / manage). Verifies the
 * sealed state cookie (CSRF), exchanges the code with the PKCE verifier,
 * verifies the ID token (signature, iss, aud, exp, nonce). Connect: stores the
 * encrypted refresh token and hands over to the calendar picker (30-min setup
 * cookie). Manage: a 15-min manage cookie proving which Google account this is.
 * The flow cookie is single use: it is deleted on every outcome.
 * Nothing from the query string is echoed back except a fixed error code.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const done = (path: string) => {
    const res = NextResponse.redirect(new URL(path, url.origin), 303);
    res.cookies.set(FLOW_COOKIE, "", cookieOptions(0, "/"));
    res.headers.set("Referrer-Policy", "no-referrer");
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  try {
    await limitConnectAttempts("calendar_callback_ip", clientIpFromHeaders((n) => request.headers.get(n)), 30);
    const redirectUri = googleRedirectUri(request.headers.get("host"));
    if (!redirectUri) return done("/connect-calendar/setup?error=not_configured");
    const outcome = await completeOAuthCallback(getExternalCalendarDeps(), {
      flowCookie: request.cookies.get(FLOW_COOKIE)?.value,
      state: url.searchParams.get("state"),
      code: url.searchParams.get("code"),
      error: url.searchParams.get("error"),
      redirectUri,
    });
    if (outcome.kind === "manage") {
      const res = done("/connect-calendar/manage");
      res.cookies.set(MANAGE_COOKIE, outcome.manageCookie, cookieOptions(outcome.maxAgeSeconds, "/connect-calendar"));
      return res;
    }
    const res = done("/connect-calendar/setup");
    res.cookies.set(SETUP_COOKIE, outcome.setupCookie, cookieOptions(outcome.maxAgeSeconds, "/connect-calendar"));
    return res;
  } catch (error) {
    return done(`/connect-calendar/setup?error=${error instanceof RateLimitedError ? "rate_limited" : toConnectError(error)}`);
  }
}
