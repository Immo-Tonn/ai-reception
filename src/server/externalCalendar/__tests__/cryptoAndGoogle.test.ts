import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPkcePair, createSecretBox, DecryptionError, parseMasterKey, seal, tokenContext, unseal } from "../crypto";
import { GOOGLE_SCOPES, GoogleCalendarProvider } from "../googleProvider";
import { CalendarProviderError } from "../provider";

const key = randomBytes(32);

describe("token encryption", () => {
  const box = createSecretBox(key, "tokens");

  it("round-trips and never contains the plaintext", () => {
    const ct = box.encrypt("1//refresh-token-value", tokenContext("ws", "staff"));
    expect(ct).not.toContain("refresh-token-value");
    expect(box.decrypt(ct, tokenContext("ws", "staff"))).toBe("1//refresh-token-value");
  });

  it("a ciphertext moved to another workspace or person does not decrypt", () => {
    const ct = box.encrypt("secret", tokenContext("ws-a", "staff-1"));
    expect(() => box.decrypt(ct, tokenContext("ws-b", "staff-1"))).toThrow(DecryptionError);
    expect(() => box.decrypt(ct, tokenContext("ws-a", "staff-2"))).toThrow(DecryptionError);
  });

  it("tampering and a different key are detected", () => {
    const ct = box.encrypt("secret", "ctx");
    const parts = ct.split(".");
    parts[3] = Buffer.from("garbage").toString("base64url");
    expect(() => box.decrypt(parts.join("."), "ctx")).toThrow(DecryptionError);
    expect(() => createSecretBox(randomBytes(32), "tokens").decrypt(ct, "ctx")).toThrow(DecryptionError);
    // The cookie key is derived separately: a token ciphertext is not a valid cookie and vice versa.
    expect(() => createSecretBox(key, "cookies").decrypt(ct, "ctx")).toThrow(DecryptionError);
  });

  it("parseMasterKey accepts exactly 32 bytes of base64", () => {
    expect(parseMasterKey(key.toString("base64"))).not.toBeNull();
    expect(parseMasterKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseMasterKey("")).toBeNull();
    expect(parseMasterKey(undefined)).toBeNull();
  });

  it("sealed cookies expire and cannot be forged", () => {
    const cookies = createSecretBox(key, "cookies");
    const now = new Date("2026-10-05T12:00:00Z");
    const sealed = seal(cookies, "flow", { state: "abc" }, new Date(now.getTime() + 60_000));
    expect(unseal(cookies, "flow", sealed, now)).toEqual({ state: "abc" });
    expect(unseal(cookies, "flow", sealed, new Date(now.getTime() + 61_000))).toBeNull();
    expect(unseal(cookies, "setup", sealed, now)).toBeNull(); // bound to its purpose
    expect(unseal(cookies, "flow", "v1.x.y.z", now)).toBeNull();
  });

  it("PKCE pair: S256 challenge of a 43-char verifier", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
});

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (url: string, init?: RequestInit) => { status: number; body?: unknown } | Promise<never>) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = await handler(url, init);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
  return { impl, calls };
}

const config = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "test-secret" };

describe("GoogleCalendarProvider", () => {
  it("authorization URL: code flow, PKCE S256, offline access, consent, ONLY the two read-only scopes", () => {
    const url = new URL(new GoogleCalendarProvider(config).buildAuthorizationUrl({ state: "st", codeChallenge: "ch", redirectUri: "https://app.test/cb" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("state")).toBe("st");
    expect(p.get("redirect_uri")).toBe("https://app.test/cb");
    expect(p.get("scope")!.split(" ").sort()).toEqual([...GOOGLE_SCOPES].sort());
    expect(p.get("scope")).not.toMatch(/openid|email|profile|calendar\.events|auth\/calendar(\s|$)/);
    expect(url.toString()).not.toContain("test-secret");
  });

  it("code exchange: refuses a grant without the required scopes and revokes it", async () => {
    const { impl, calls } = fakeFetch((url) =>
      url.includes("/token")
        ? { status: 200, body: { access_token: "a", refresh_token: "r", scope: GOOGLE_SCOPES[1] } }
        : { status: 200, body: {} },
    );
    const p = new GoogleCalendarProvider(config, impl);
    await expect(p.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "https://app.test/cb" })).rejects.toMatchObject({ code: "insufficient_scope" });
    expect(calls.some((c) => c.url.includes("/revoke"))).toBe(true);
    // The verifier and the secret go in the POST body, never in a URL.
    const body = String(calls[0].init?.body);
    expect(body).toContain("code_verifier=v");
    expect(calls[0].url).not.toContain("secret");
  });

  it("code exchange: returns the refresh token when both scopes were granted", async () => {
    const { impl } = fakeFetch(() => ({ status: 200, body: { access_token: "a", refresh_token: "r-1", scope: GOOGLE_SCOPES.join(" ") } }));
    await expect(new GoogleCalendarProvider(config, impl).exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "x" })).resolves.toEqual({ refreshToken: "r-1" });
  });

  it("refresh: invalid_grant means revoked; invalid_client means misconfigured; 5xx/network means unavailable", async () => {
    const mk = (status: number, body: unknown) => new GoogleCalendarProvider(config, fakeFetch(() => ({ status, body })).impl);
    await expect(mk(400, { error: "invalid_grant" }).getAccessToken("r")).rejects.toMatchObject({ code: "revoked" });
    await expect(mk(401, { error: "invalid_client" }).getAccessToken("r")).rejects.toMatchObject({ code: "not_configured" });
    await expect(mk(503, {}).getAccessToken("r")).rejects.toMatchObject({ code: "unavailable" });
    const offline = new GoogleCalendarProvider(config, async () => {
      throw new TypeError("fetch failed");
    });
    await expect(offline.getAccessToken("r")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("FreeBusy: returns only start/end; a per-calendar error or a missing entry is a failure, never 'free'", async () => {
    const ok = fakeFetch(() => ({
      status: 200,
      body: { calendars: { a: { busy: [{ start: "2026-10-05T12:00:00Z", end: "2026-10-05T13:00:00Z" }] }, b: { busy: [] } } },
    }));
    const p = new GoogleCalendarProvider(config, ok.impl);
    await expect(p.getBusy("at", ["a", "b"], new Date("2026-10-05T00:00:00Z"), new Date("2026-10-06T00:00:00Z"))).resolves.toEqual([
      { start: "2026-10-05T12:00:00Z", end: "2026-10-05T13:00:00Z" },
    ]);
    const sent = JSON.parse(String(ok.calls[0].init?.body));
    expect(sent).toEqual({ timeMin: "2026-10-05T00:00:00.000Z", timeMax: "2026-10-06T00:00:00.000Z", items: [{ id: "a" }, { id: "b" }] });
    expect(String((ok.calls[0].init?.headers as Record<string, string>).authorization)).toBe("Bearer at");

    const notFound = new GoogleCalendarProvider(config, fakeFetch(() => ({ status: 200, body: { calendars: { a: { errors: [{ reason: "notFound" }] } } } })).impl);
    await expect(notFound.getBusy("at", ["a"], new Date(), new Date(Date.now() + 1000))).rejects.toMatchObject({ code: "calendar_not_found" });
    const missing = new GoogleCalendarProvider(config, fakeFetch(() => ({ status: 200, body: { calendars: {} } })).impl);
    await expect(missing.getBusy("at", ["a"], new Date(), new Date(Date.now() + 1000))).rejects.toMatchObject({ code: "invalid_response" });
    const limited = new GoogleCalendarProvider(config, fakeFetch(() => ({ status: 429, body: {} })).impl);
    await expect(limited.getBusy("at", ["a"], new Date(), new Date(Date.now() + 1000))).rejects.toBeInstanceOf(CalendarProviderError);
    const expired = new GoogleCalendarProvider(config, fakeFetch(() => ({ status: 401, body: {} })).impl);
    await expect(expired.getBusy("at", ["a"], new Date(), new Date(Date.now() + 1000))).rejects.toMatchObject({ code: "revoked" });
  });

  it("calendar list: primary first, deleted ones dropped, only freeBusyReader+ requested", async () => {
    const { impl, calls } = fakeFetch(() => ({
      status: 200,
      body: { items: [{ id: "work", summary: "Work" }, { id: "me@x", summary: "Me", primary: true }, { id: "old", summary: "Old", deleted: true }] },
    }));
    const list = await new GoogleCalendarProvider(config, impl).listCalendars("at");
    expect(list).toEqual([
      { id: "me@x", name: "Me", primary: true },
      { id: "work", name: "Work", primary: false },
    ]);
    expect(new URL(calls[0].url).searchParams.get("minAccessRole")).toBe("freeBusyReader");
  });
});

describe("store before migration 0025 is applied", () => {
  it("a missing table means 'no connections' (booking keeps working), any other error propagates", async () => {
    const { createSupabaseExternalCalendarStore } = await import("../store");
    const fake = (code: string) =>
      ({ from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { code, message: "x" } }) }) }) }) as never;
    await expect(createSupabaseExternalCalendarStore(fake("42P01")).listConnections("ws")).resolves.toEqual([]);
    await expect(createSupabaseExternalCalendarStore(fake("PGRST205")).listConnections("ws")).resolves.toEqual([]);
    await expect(createSupabaseExternalCalendarStore(fake("57014")).listConnections("ws")).rejects.toThrow();
  });
});
