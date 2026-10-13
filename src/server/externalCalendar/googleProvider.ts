import { EXTERNAL_BUSY_POLICY } from "@/features/externalCalendar/policy";
import { CalendarProviderError, type CalendarProvider, type ProviderCalendar } from "./provider";
import { IdTokenError, createGoogleJwksSource, verifyGoogleIdToken, type JwksSource } from "./idToken";

/**
 * Google Calendar adapter — official REST endpoints (OAuth 2.0 + Calendar API
 * v3), plain `fetch`, no SDK dependency.
 *
 * Scopes (minimal, read-only):
 *   - calendar.freebusy               -> busy intervals only (no event details)
 *   - calendar.calendarlist.readonly  -> the list of calendars to choose from
 *   - openid                          -> a signed ID token with the stable account id `sub`
 *                                        (stored only as an HMAC). No `email`/`profile`.
 * No scope that can create, change or delete events.
 */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;
export const GOOGLE_SCOPES = ["openid", ...GOOGLE_CALENDAR_SCOPES] as const;
/** Proving "this is my Google account" on the manage page: nothing else. */
export const GOOGLE_IDENTIFY_SCOPES = ["openid"] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";
/** FreeBusy accepts at most 50 calendars per request; we allow far fewer per person. */
const MAX_ITEMS = 50;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = "google" as const;

  private jwks: JwksSource & { forceNext?: () => void };

  constructor(
    private config: GoogleOAuthConfig,
    private fetchImpl: FetchLike = (input, init) => fetch(input, init),
    jwks?: JwksSource,
    private now: () => Date = () => new Date(),
  ) {
    this.jwks = jwks ?? createGoogleJwksSource(fetchImpl);
  }

  /** Verifies the ID token of a token response; one JWKS refresh on an unknown key (rotation). */
  private async verifiedSubject(idToken: unknown, nonce: string): Promise<string> {
    const verifyOnce = () => verifyGoogleIdToken(idToken, { clientId: this.config.clientId, nonce, now: this.now(), jwks: this.jwks });
    try {
      return (await verifyOnce()).subject;
    } catch (error) {
      if (error instanceof IdTokenError && error.reason === "unknown_key" && this.jwks.forceNext) {
        this.jwks.forceNext();
        try {
          return (await verifyOnce()).subject;
        } catch {
          throw new CalendarProviderError("identity_invalid");
        }
      }
      throw new CalendarProviderError(error instanceof IdTokenError && error.reason === "jwks_unavailable" ? "unavailable" : "identity_invalid");
    }
  }

  private async tokenRequest(params: Record<string, string>) {
    const res = await this.call(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.config.clientId, client_secret: this.config.clientSecret, ...params }).toString(),
    });
    return { res, body: await GoogleCalendarProvider.json(res) };
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(EXTERNAL_BUSY_POLICY.requestTimeoutMs) });
    } catch {
      throw new CalendarProviderError("unavailable"); // network error / timeout: never "free"
    }
  }

  private static async json(res: Response): Promise<Record<string, unknown>> {
    try {
      const body = await res.json();
      return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** Maps an API (non-OAuth) failure to a stable code. */
  private static apiError(res: Response): CalendarProviderError {
    if (res.status === 401) return new CalendarProviderError("revoked");
    if (res.status === 404) return new CalendarProviderError("calendar_not_found");
    if (res.status === 429 || res.status === 403) return new CalendarProviderError("rate_limited");
    return new CalendarProviderError("unavailable");
  }

  buildAuthorizationUrl({
    state,
    codeChallenge,
    redirectUri,
    nonce,
    purpose,
  }: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    nonce: string;
    purpose: "connect" | "identify";
  }): string {
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    if (purpose === "connect") {
      url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
      url.searchParams.set("access_type", "offline");
      // Always show consent so Google issues a refresh token even on a reconnect.
      url.searchParams.set("prompt", "consent");
    } else {
      url.searchParams.set("scope", GOOGLE_IDENTIFY_SCOPES.join(" "));
      url.searchParams.set("access_type", "online"); // no refresh token for a sign-in check
      url.searchParams.set("prompt", "select_account");
    }
    url.searchParams.set("include_granted_scopes", "false");
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async exchangeCode({ code, codeVerifier, redirectUri, nonce }: { code: string; codeVerifier: string; redirectUri: string; nonce: string }) {
    const { res, body } = await this.tokenRequest({ code, code_verifier: codeVerifier, redirect_uri: redirectUri, grant_type: "authorization_code" });
    if (!res.ok) {
      throw new CalendarProviderError(body.error === "invalid_grant" ? "invalid_grant_code" : "unavailable");
    }
    // Granular consent: the person may untick a permission. All are required.
    // (No revoke here: revoking would also cut other ServiceOS connections of this Google account.)
    const granted = typeof body.scope === "string" ? body.scope.split(" ") : [];
    if (!GOOGLE_CALENDAR_SCOPES.every((s) => granted.includes(s))) throw new CalendarProviderError("insufficient_scope");
    if (typeof body.refresh_token !== "string" || !body.refresh_token) throw new CalendarProviderError("no_refresh_token");
    const subject = await this.verifiedSubject(body.id_token, nonce);
    return { refreshToken: body.refresh_token, subject };
  }

  async exchangeIdentity({ code, codeVerifier, redirectUri, nonce }: { code: string; codeVerifier: string; redirectUri: string; nonce: string }) {
    const { res, body } = await this.tokenRequest({ code, code_verifier: codeVerifier, redirect_uri: redirectUri, grant_type: "authorization_code" });
    if (!res.ok) throw new CalendarProviderError(body.error === "invalid_grant" ? "invalid_grant_code" : "unavailable");
    // The short-lived access token of this sign-in is simply dropped (revoking it would revoke the whole grant).
    return { subject: await this.verifiedSubject(body.id_token, nonce) };
  }

  async getAccessToken(refreshToken: string) {
    const { res, body } = await this.tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });
    if (!res.ok) {
      // invalid_grant = revoked by the user, password change, expired (7 days in "Testing" mode), ...
      if (body.error === "invalid_grant") throw new CalendarProviderError("revoked");
      if (res.status === 401 || body.error === "invalid_client" || body.error === "unauthorized_client") {
        throw new CalendarProviderError("not_configured");
      }
      throw new CalendarProviderError(res.status === 429 ? "rate_limited" : "unavailable");
    }
    if (typeof body.access_token !== "string" || !body.access_token) throw new CalendarProviderError("invalid_response");
    return body.access_token;
  }

  async listCalendars(accessToken: string): Promise<ProviderCalendar[]> {
    const out: ProviderCalendar[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const url = new URL(`${API}/users/me/calendarList`);
      url.searchParams.set("minAccessRole", "freeBusyReader");
      url.searchParams.set("maxResults", "250");
      url.searchParams.set("fields", "nextPageToken,items(id,summary,summaryOverride,primary,deleted,hidden)");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const res = await this.call(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw GoogleCalendarProvider.apiError(res);
      const body = await GoogleCalendarProvider.json(res);
      const items = Array.isArray(body.items) ? body.items : [];
      for (const raw of items as Record<string, unknown>[]) {
        if (typeof raw.id !== "string" || raw.deleted === true) continue;
        const name = typeof raw.summaryOverride === "string" ? raw.summaryOverride : typeof raw.summary === "string" ? raw.summary : raw.id;
        out.push({ id: raw.id, name: name.slice(0, 200), primary: raw.primary === true });
      }
      pageToken = typeof body.nextPageToken === "string" ? body.nextPageToken : undefined;
      if (!pageToken) break;
    }
    return out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
  }

  async getBusy(accessToken: string, calendarIds: string[], from: Date, until: Date) {
    if (calendarIds.length === 0) return [];
    if (calendarIds.length > MAX_ITEMS) throw new CalendarProviderError("invalid_response");
    const res = await this.call(`${API}/freeBusy`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: until.toISOString(), items: calendarIds.map((id) => ({ id })) }),
    });
    if (!res.ok) throw GoogleCalendarProvider.apiError(res);
    const body = await GoogleCalendarProvider.json(res);
    const calendars = body.calendars as Record<string, { busy?: unknown; errors?: unknown }> | undefined;
    if (!calendars || typeof calendars !== "object") throw new CalendarProviderError("invalid_response");

    const out: { start: string; end: string }[] = [];
    for (const id of calendarIds) {
      const entry = calendars[id];
      // A missing entry or a per-calendar error means we do NOT know this calendar's busy time.
      if (!entry) throw new CalendarProviderError("invalid_response");
      if (Array.isArray(entry.errors) && entry.errors.length > 0) {
        const reason = (entry.errors[0] as { reason?: unknown })?.reason;
        throw new CalendarProviderError(reason === "notFound" ? "calendar_not_found" : "unavailable");
      }
      if (!Array.isArray(entry.busy)) throw new CalendarProviderError("invalid_response");
      for (const b of entry.busy as { start?: unknown; end?: unknown }[]) {
        if (typeof b?.start !== "string" || typeof b?.end !== "string") throw new CalendarProviderError("invalid_response");
        out.push({ start: b.start, end: b.end });
      }
    }
    return out;
  }

  async revoke(refreshToken: string) {
    try {
      await this.call(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refreshToken }).toString(),
      });
    } catch {
      // Best effort: the connection is removed on our side regardless.
    }
  }
}
