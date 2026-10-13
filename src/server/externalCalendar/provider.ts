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
  /** Consent page URL (authorization code flow + PKCE, offline access, minimal scopes). */
  buildAuthorizationUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  /** One-time code -> long-lived refresh token. Throws `CalendarProviderError("insufficient_scope" | ...)`. */
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ refreshToken: string }>;
  /** Refresh token -> short-lived access token (kept in memory only). `revoked` when access was withdrawn. */
  getAccessToken(refreshToken: string): Promise<string>;
  listCalendars(accessToken: string): Promise<ProviderCalendar[]>;
  /** Raw busy blocks of the given calendars in [from, until). Any per-calendar error fails the whole call. */
  getBusy(accessToken: string, calendarIds: string[], from: Date, until: Date): Promise<{ start: string; end: string }[]>;
  /** Best effort; never throws. */
  revoke(refreshToken: string): Promise<void>;
}

export type ProviderErrorCode = ExternalCalendarErrorCode | "insufficient_scope" | "no_refresh_token" | "invalid_grant_code";

export class CalendarProviderError extends Error {
  constructor(public code: ProviderErrorCode) {
    super(`Calendar provider error: ${code}`);
    this.name = "CalendarProviderError";
  }
}
