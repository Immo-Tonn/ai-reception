import type { ExternalCalendarErrorCode, ExternalCalendarProviderId } from "@/features/externalCalendar/types";

/**
 * Our own provider boundary (docs/PRODUCT_ARCHITECTURE.md §4.3). The
 * application layer (`ExternalCalendarService`) only talks to this; Google is
 * one adapter, a mock is another, Microsoft can follow. Read-only by design:
 * there is no method that writes to a calendar.
 */
export interface ProviderCalendar {
  id: string;
  /** Shown ONLY to the person connecting (calendar picker); never stored. */
  name: string;
  primary: boolean;
}

export interface CalendarProvider {
  readonly id: ExternalCalendarProviderId;
  /**
   * Consent page URL (authorization code flow + PKCE + OIDC nonce).
   * - `connect`: offline access, calendar scopes + `openid`
   * - `identify`: `openid` only, no refresh token (used to prove "this is my Google account")
   */
  buildAuthorizationUrl(params: { state: string; codeChallenge: string; redirectUri: string; nonce: string; purpose: "connect" | "identify" }): string;
  /**
   * One-time code -> long-lived refresh token + the VERIFIED stable account id (`sub` of a signed ID token).
   * Throws `CalendarProviderError("insufficient_scope" | "identity_invalid" | ...)`.
   */
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<{ refreshToken: string; subject: string }>;
  /** `identify` flow: code -> verified `sub` only. Nothing is stored and nothing is revoked. */
  exchangeIdentity(params: { code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<{ subject: string }>;
  /** Refresh token -> short-lived access token (kept in memory only). `revoked` when access was withdrawn. */
  getAccessToken(refreshToken: string): Promise<string>;
  listCalendars(accessToken: string): Promise<ProviderCalendar[]>;
  /** Raw busy blocks of the given calendars in [from, until). Any per-calendar error fails the whole call. */
  getBusy(accessToken: string, calendarIds: string[], from: Date, until: Date): Promise<{ start: string; end: string }[]>;
  /**
   * Best effort; never throws. NOTE (Google): revoking ANY token removes the whole grant of
   * this Google account for our project — every ServiceOS connection of that account stops
   * working. Callers revoke only when no other connection of the same account remains.
   */
  revoke(refreshToken: string): Promise<void>;
}

export type ProviderErrorCode =
  | ExternalCalendarErrorCode
  | "insufficient_scope"
  | "no_refresh_token"
  | "invalid_grant_code"
  | "identity_invalid";

export class CalendarProviderError extends Error {
  constructor(public code: ProviderErrorCode) {
    super(`Calendar provider error: ${code}`);
    this.name = "CalendarProviderError";
  }
}
