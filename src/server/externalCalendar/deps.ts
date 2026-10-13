import "server-only";
import { createSupabaseAdminClient, SupabaseAdminNotConfiguredError } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPublicBaseUrl } from "@/lib/config/publicBaseUrl";
import { createSecretBox, createSubjectHasher, parseMasterKey } from "./crypto";
import { GoogleCalendarProvider } from "./googleProvider";
import { createSupabaseExternalCalendarStore } from "./store";
import { loadExternalBusy, type ExternalCalendarDeps } from "./service";
import type { ExternalBusyLoader } from "./engineInput";

/**
 * Production wiring for external calendars. Server-only ENV (never
 * NEXT_PUBLIC_):
 *   GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET — Google OAuth client (Web application)
 *   EXTERNAL_CALENDAR_ENCRYPTION_KEY — 32 random bytes, base64 (encrypts refresh tokens, seals OAuth cookies)
 * Missing values leave the integration "not configured": nothing can be
 * connected, and already-connected people become unconfirmed (no slots) rather
 * than silently free. The service-role client is used because these tables
 * have no RLS policies (migration 0025); every caller authorizes first.
 */
export const GOOGLE_CALLBACK_PATH = "/api/integrations/google-calendar/callback";

export function getExternalCalendarDeps(): ExternalCalendarDeps {
  const key = parseMasterKey(process.env.EXTERNAL_CALENDAR_ENCRYPTION_KEY);
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  return {
    store: createSupabaseExternalCalendarStore(createSupabaseAdminClient()),
    provider: clientId && clientSecret ? new GoogleCalendarProvider({ clientId, clientSecret }) : null,
    tokens: key ? createSecretBox(key, "tokens") : null,
    cookies: key ? createSecretBox(key, "cookies") : null,
    subjects: key ? createSubjectHasher(key) : null,
  };
}

/** The exact redirect URI registered in Google Cloud (must match byte for byte). `null` = no public address configured. */
export function googleRedirectUri(requestHost: string | null): string | null {
  const { baseUrl } = getPublicBaseUrl(requestHost);
  return baseUrl ? `${baseUrl}${GOOGLE_CALLBACK_PATH}` : null;
}

/**
 * Busy-time loader for booking code. Absent when Supabase or its service-role
 * key is not configured: then no connection can exist or be read, and booking
 * behaves exactly as without the integration.
 */
export function getExternalBusyLoader(): ExternalBusyLoader | undefined {
  if (!isSupabaseConfigured()) return undefined;
  let deps: ExternalCalendarDeps;
  try {
    deps = getExternalCalendarDeps();
  } catch (error) {
    if (error instanceof SupabaseAdminNotConfiguredError) return undefined;
    throw error;
  }
  return (args) => loadExternalBusy(deps, args);
}
