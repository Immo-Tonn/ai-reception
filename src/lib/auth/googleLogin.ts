import { DEFAULT_CLIENT_REDIRECT, sanitizeClientRedirect } from "@/features/clientAccount/redirect";

/**
 * Sign-in / sign-up with Google through Supabase Auth (the provider and its keys are
 * configured in the Supabase dashboard, not in this app). Pure helpers, no I/O.
 *
 *  - The feature is OFF until `GOOGLE_LOGIN_ENABLED=true` (exactly that value, server-side
 *    only). While it is off no Google button is shown and the entry action refuses.
 *  - Where the person was going (owner or client, and the client's return path) travels in a
 *    short-lived httpOnly cookie, never in the callback URL: the callback URL must match the
 *    Supabase redirect allow-list exactly, and a URL parameter could be forged.
 */
export type GoogleIntent = "owner" | "client";

/** Stable codes shown to the person; the provider's own messages never reach the browser. */
export type GoogleErrorCode =
  | "google_cancelled"
  | "google_failed"
  | "google_unavailable"
  | "google_unverified"
  | "rate_limited";

export const GOOGLE_ERROR_CODES: readonly GoogleErrorCode[] = [
  "google_cancelled",
  "google_failed",
  "google_unavailable",
  "google_unverified",
  "rate_limited",
];

export const GOOGLE_CONTEXT_COOKIE = "sos_google_ctx";
export const GOOGLE_CONTEXT_MAX_AGE_SECONDS = 10 * 60;
export const GOOGLE_CALLBACK_PATH = "/auth/callback";

export interface GoogleContext {
  intent: GoogleIntent;
  /** Client return path (always an internal `/client…` path); empty for owners. */
  next: string;
}

export function isGoogleLoginEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GOOGLE_LOGIN_ENABLED === "true";
}

export function parseGoogleIntent(raw: unknown): GoogleIntent {
  return raw === "client" ? "client" : "owner";
}

export function isGoogleErrorCode(value: unknown): value is GoogleErrorCode {
  return typeof value === "string" && (GOOGLE_ERROR_CODES as readonly string[]).includes(value);
}

export function buildGoogleContext(intent: GoogleIntent, next: unknown): GoogleContext {
  return { intent, next: intent === "client" ? sanitizeClientRedirect(next) : "" };
}

export function encodeGoogleContext(ctx: GoogleContext): string {
  return `${ctx.intent}|${encodeURIComponent(ctx.next)}`;
}

/** Strict: anything that is not exactly what `encodeGoogleContext` writes falls back to `null`. */
export function parseGoogleContext(raw: string | undefined | null): GoogleContext | null {
  if (!raw || raw.length > 400) return null;
  const sep = raw.indexOf("|");
  if (sep < 0) return null;
  const intent = raw.slice(0, sep);
  if (intent !== "owner" && intent !== "client") return null;
  let next: string;
  try {
    next = decodeURIComponent(raw.slice(sep + 1));
  } catch {
    return null;
  }
  return buildGoogleContext(intent, next);
}

/** Where a failed or cancelled attempt goes back to: the page the person came from. */
export function googleFailureHref(intent: GoogleIntent, code: GoogleErrorCode, next: string = DEFAULT_CLIENT_REDIRECT): string {
  if (intent === "client") {
    return `/client/login?redirect=${encodeURIComponent(sanitizeClientRedirect(next))}&google=${code}`;
  }
  return `/login?google=${code}`;
}

/** Where a successful Google sign-in goes. Owners without a workspace finish sign-up first. */
export function googleLandingPath(ctx: GoogleContext, homeSlug: string | null): string {
  if (ctx.intent === "client") return sanitizeClientRedirect(ctx.next);
  return homeSlug ? `/${homeSlug}/today` : "/signup/google";
}

/** `?google=<code>` from a failed attempt: only known codes are ever shown. */
export function googleErrorFromParam(raw: unknown): GoogleErrorCode | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isGoogleErrorCode(value) ? value : null;
}
