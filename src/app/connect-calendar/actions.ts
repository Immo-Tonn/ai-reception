"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromHeaders } from "@/server/ratelimit/rateLimiter";
import { getExternalCalendarDeps, googleRedirectUri } from "@/server/externalCalendar/deps";
import {
  FLOW_COOKIE,
  MANAGE_COOKIE,
  SETUP_COOKIE,
  disconnectAllManagedConnections,
  disconnectFromSetup,
  disconnectManagedConnection,
  saveCalendarChoices,
  startAuthorization,
  startIdentification,
} from "@/server/externalCalendar/service";
import { cookieOptions, limitConnectAttempts, RateLimitedError, toConnectError, type ConnectPageError } from "@/server/externalCalendar/http";
import { TOKEN_RE } from "@/server/externalCalendar/crypto";

/**
 * Public steps of connecting a Google Calendar (no ServiceOS login: the
 * single-use link is the credential). Server Actions bring Next's own
 * Origin check; OAuth state + PKCE travel in a sealed httpOnly cookie.
 */
export async function startGoogleConnectAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!TOKEN_RE.test(token)) redirect("/connect-calendar/setup?error=invalid_link");

  let target: string;
  try {
    const h = await headers();
    await limitConnectAttempts("calendar_connect_ip", clientIpFromHeaders((n) => h.get(n)), 20);
    const redirectUri = googleRedirectUri(h.get("host"));
    if (!redirectUri) throw new Error("no public base url");
    const { authorizationUrl, flowCookie, maxAgeSeconds } = await startAuthorization(getExternalCalendarDeps(), token, redirectUri);
    (await cookies()).set(FLOW_COOKIE, flowCookie, cookieOptions(maxAgeSeconds, "/"));
    target = authorizationUrl;
  } catch (error) {
    const code: ConnectPageError = error instanceof RateLimitedError ? "rate_limited" : toConnectError(error);
    target = `/connect-calendar/${token}?error=${code}`;
  }
  redirect(target);
}

export async function saveCalendarsAction(formData: FormData): Promise<void> {
  const ids = formData.getAll("calendar").map(String);
  let target = "/connect-calendar/setup?saved=1";
  try {
    const store = await cookies();
    await saveCalendarChoices(getExternalCalendarDeps(), store.get(SETUP_COOKIE)?.value, ids);
  } catch (error) {
    target = `/connect-calendar/setup?error=${toConnectError(error)}`;
  }
  redirect(target);
}

export async function disconnectFromSetupAction(): Promise<void> {
  let target = "/connect-calendar/setup?disconnected=1";
  try {
    const store = await cookies();
    await disconnectFromSetup(getExternalCalendarDeps(), store.get(SETUP_COOKIE)?.value);
    store.delete({ name: SETUP_COOKIE, path: "/connect-calendar" });
  } catch (error) {
    target = `/connect-calendar/setup?error=${toConnectError(error)}`;
  }
  redirect(target);
}

// ---- Manage page (/connect-calendar/manage): sign in with Google, then disconnect ----

const MANAGE = "/connect-calendar/manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startManageAction(): Promise<void> {
  let target: string;
  try {
    const h = await headers();
    await limitConnectAttempts("calendar_manage_ip", clientIpFromHeaders((n) => h.get(n)), 20);
    const redirectUri = googleRedirectUri(h.get("host"));
    if (!redirectUri) throw new Error("no public base url");
    const { authorizationUrl, flowCookie, maxAgeSeconds } = await startIdentification(getExternalCalendarDeps(), redirectUri);
    (await cookies()).set(FLOW_COOKIE, flowCookie, cookieOptions(maxAgeSeconds, "/"));
    target = authorizationUrl;
  } catch (error) {
    target = `${MANAGE}?error=${error instanceof RateLimitedError ? "rate_limited" : toConnectError(error)}`;
  }
  redirect(target);
}

export async function disconnectManagedAction(formData: FormData): Promise<void> {
  const id = String(formData.get("connectionId") ?? "");
  let target = `${MANAGE}?done=invalid`;
  if (UUID.test(id)) {
    try {
      const h = await headers();
      await limitConnectAttempts("calendar_manage_disconnect_ip", clientIpFromHeaders((n) => h.get(n)), 30);
      const grant = await disconnectManagedConnection(getExternalCalendarDeps(), (await cookies()).get(MANAGE_COOKIE)?.value, id);
      target = `${MANAGE}?done=${grant === "kept_shared" ? "shared" : "revoked"}`;
    } catch (error) {
      target = `${MANAGE}?error=${error instanceof RateLimitedError ? "rate_limited" : toConnectError(error)}`;
    }
  }
  redirect(target);
}

export async function disconnectAllManagedAction(): Promise<void> {
  let target = `${MANAGE}?done=all`;
  try {
    const h = await headers();
    await limitConnectAttempts("calendar_manage_disconnect_ip", clientIpFromHeaders((n) => h.get(n)), 30);
    await disconnectAllManagedConnections(getExternalCalendarDeps(), (await cookies()).get(MANAGE_COOKIE)?.value);
  } catch (error) {
    target = `${MANAGE}?error=${error instanceof RateLimitedError ? "rate_limited" : toConnectError(error)}`;
  }
  redirect(target);
}

export async function endManageAction(): Promise<void> {
  (await cookies()).delete({ name: MANAGE_COOKIE, path: "/connect-calendar" });
  redirect(MANAGE);
}
