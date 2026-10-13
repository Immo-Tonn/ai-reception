import type { CalendarProvider, ProviderCalendar } from "./provider";
import { CalendarProviderError, type ProviderErrorCode } from "./provider";

/**
 * In-memory provider for tests (and for explaining the flow). Each "account"
 * is keyed by its refresh token and owns calendars with busy blocks. Failures
 * can be injected per account to exercise the safety policy. Records every
 * call so tests can assert how often the provider was asked.
 */
export interface MockAccount {
  calendars: (ProviderCalendar & { busy: { start: string; end: string }[] })[];
  failWith?: ProviderErrorCode;
}

export class MockCalendarProvider implements CalendarProvider {
  readonly id = "google" as const;
  readonly accounts = new Map<string, MockAccount>();
  /** code -> refresh token handed out by `exchangeCode`. */
  readonly codes = new Map<string, string>();
  readonly calls: { method: string; at: number }[] = [];
  readonly revoked: string[] = [];

  private log(method: string) {
    this.calls.push({ method, at: this.calls.length });
  }

  countCalls(method: string): number {
    return this.calls.filter((c) => c.method === method).length;
  }

  buildAuthorizationUrl({ state, codeChallenge, redirectUri }: { state: string; codeChallenge: string; redirectUri: string }): string {
    const url = new URL("https://mock-provider.invalid/authorize");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("redirect_uri", redirectUri);
    return url.toString();
  }

  async exchangeCode({ code }: { code: string; codeVerifier: string; redirectUri: string }) {
    this.log("exchangeCode");
    const refreshToken = this.codes.get(code);
    if (!refreshToken) throw new CalendarProviderError("invalid_grant_code");
    return { refreshToken };
  }

  private account(token: string): MockAccount {
    const account = this.accounts.get(token.replace(/^access:/, ""));
    if (!account) throw new CalendarProviderError("revoked");
    if (account.failWith) throw new CalendarProviderError(account.failWith);
    return account;
  }

  async getAccessToken(refreshToken: string) {
    this.log("getAccessToken");
    this.account(refreshToken);
    return `access:${refreshToken}`;
  }

  async listCalendars(accessToken: string) {
    this.log("listCalendars");
    return this.account(accessToken).calendars.map(({ id, name, primary }) => ({ id, name, primary }));
  }

  async getBusy(accessToken: string, calendarIds: string[], from: Date, until: Date) {
    this.log("getBusy");
    const account = this.account(accessToken);
    const out: { start: string; end: string }[] = [];
    for (const id of calendarIds) {
      const calendar = account.calendars.find((c) => c.id === id);
      if (!calendar) throw new CalendarProviderError("calendar_not_found");
      for (const b of calendar.busy) {
        if (Date.parse(b.end) > from.getTime() && Date.parse(b.start) < until.getTime()) out.push(b);
      }
    }
    return out;
  }

  async revoke(refreshToken: string) {
    this.revoked.push(refreshToken);
    this.accounts.delete(refreshToken);
  }
}
