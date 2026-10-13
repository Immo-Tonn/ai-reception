import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPkcePair, createSecretBox, DecryptionError, parseMasterKey, seal, tokenContext, unseal } from "../crypto";
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_SCOPES, GoogleCalendarProvider } from "../googleProvider";
import { GOOGLE_DISCOVERY_URL, createGoogleJwksSource, verifyGoogleIdToken } from "../idToken";
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

// ---- Signed ID tokens with a test key standing in for Google's ----
const { publicKey: testPub, privateKey: testPriv } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const testJwk = { ...(testPub.export({ format: "jwk" }) as object), kid: "test-kid", alg: "RS256", use: "sig" };
const jwks = async () => [testJwk as never];
const NOW = new Date("2026-10-13T12:00:00Z");
function idToken(claims: Record<string, unknown>, opts: { kid?: string; key?: typeof testPriv; alg?: string } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "test-kid", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({
    iss: "https://accounts.google.com", aud: config.clientId, sub: "1234567890", nonce: "n-1",
    iat: Math.floor(NOW.getTime() / 1000) - 10, exp: Math.floor(NOW.getTime() / 1000) + 3600, ...claims,
  })).toString("base64url");
  const sig = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), opts.key ?? testPriv).toString("base64url");
  return `${header}.${body}.${sig}`;
}
const verifyAt = (token: string, nonce = "n-1") => verifyGoogleIdToken(token, { clientId: config.clientId, nonce, now: NOW, jwks });

describe("Google ID token verification (OpenID Connect)", () => {
  it("accepts a correctly signed token and returns only the stable account id", async () => {
    await expect(verifyAt(idToken({ email: "x@example.com" }))).resolves.toEqual({ subject: "1234567890" });
  });

  it.each([
    ["signature by another key", () => idToken({}, { key: generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey }), "signature"],
    ["unknown key id", () => idToken({}, { kid: "other" }), "unknown_key"],
    ["alg none / HS256", () => idToken({}, { alg: "HS256" }), "alg"],
    ["wrong issuer", () => idToken({ iss: "https://evil.example" }), "iss"],
    ["wrong audience (token for another app)", () => idToken({ aud: "other-client" }), "aud"],
    ["wrong azp", () => idToken({ azp: "other-client" }), "azp"],
    ["expired", () => idToken({ exp: Math.floor(NOW.getTime() / 1000) - 120 }), "exp"],
    ["issued in the future", () => idToken({ iat: Math.floor(NOW.getTime() / 1000) + 600 }), "iat"],
    ["wrong nonce (replay of another flow)", () => idToken({ nonce: "n-2" }), "nonce"],
    ["missing nonce", () => idToken({ nonce: undefined }), "nonce"],
    ["missing sub", () => idToken({ sub: undefined }), "sub"],
  ])("rejects %s", async (_label, make, reason) => {
    await expect(verifyAt(make())).rejects.toMatchObject({ name: "IdTokenError", reason });
  });

  it("rejects a tampered payload", async () => {
    const [h, , sig] = idToken({}).split(".");
    const forged = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: config.clientId, sub: "attacker", nonce: "n-1", exp: 9e9 })).toString("base64url");
    await expect(verifyAt(`${h}.${forged}.${sig}`)).rejects.toMatchObject({ reason: "signature" });
  });

  it("JWKS: read from Google's discovery document, cached, refreshed on demand", async () => {
    const urls: string[] = [];
    const src = createGoogleJwksSource(async (u) => {
      urls.push(u);
      if (u === GOOGLE_DISCOVERY_URL) return new Response(JSON.stringify({ jwks_uri: "https://www.googleapis.com/oauth2/v3/certs" }));
      return new Response(JSON.stringify({ keys: [testJwk] }), { headers: { "cache-control": "public, max-age=3600" } });
    });
    await src();
    await src();
    expect(urls).toEqual([GOOGLE_DISCOVERY_URL, "https://www.googleapis.com/oauth2/v3/certs"]);
    src.forceNext();
    await src();
    expect(urls).toHaveLength(4);
    const evil = createGoogleJwksSource(async () => new Response(JSON.stringify({ jwks_uri: "https://evil.example/keys" })));
    await expect(evil()).rejects.toMatchObject({ reason: "jwks_unavailable" });
  });
});

describe("GoogleCalendarProvider", () => {
  const provider = (impl: Parameters<typeof fakeFetch>[0]) => new GoogleCalendarProvider(config, fakeFetch(impl).impl, jwks, () => NOW);

  it("connect URL: code flow, PKCE S256, nonce, offline, consent; scopes = openid + the two read-only calendar scopes", () => {
    const url = new URL(new GoogleCalendarProvider(config).buildAuthorizationUrl({ state: "st", codeChallenge: "ch", redirectUri: "https://app.test/cb", nonce: "n-1", purpose: "connect" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = url.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("state")).toBe("st");
    expect(p.get("nonce")).toBe("n-1");
    expect(p.get("redirect_uri")).toBe("https://app.test/cb");
    expect(p.get("scope")!.split(" ").sort()).toEqual([...GOOGLE_SCOPES].sort());
    expect(p.get("scope")).not.toMatch(/email|profile|calendar\.events|auth\/calendar(\s|$)/);
    expect(url.toString()).not.toContain("test-secret");
  });

  it("identify URL (manage page): openid ONLY, online access (no refresh token), account chooser", () => {
    const p = new URL(new GoogleCalendarProvider(config).buildAuthorizationUrl({ state: "st", codeChallenge: "ch", redirectUri: "x", nonce: "n", purpose: "identify" })).searchParams;
    expect(p.get("scope")).toBe("openid");
    expect(p.get("access_type")).toBe("online");
    expect(p.get("prompt")).toBe("select_account");
  });

  it("code exchange: refuses a grant without the calendar scopes and does NOT revoke (that would cut other connections)", async () => {
    const calls: string[] = [];
    const p = provider((url) => {
      calls.push(url);
      return { status: 200, body: { access_token: "a", refresh_token: "r", id_token: idToken({}), scope: "openid " + GOOGLE_CALENDAR_SCOPES[1] } };
    });
    await expect(p.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "https://app.test/cb", nonce: "n-1" })).rejects.toMatchObject({ code: "insufficient_scope" });
    expect(calls.some((c) => c.includes("/revoke"))).toBe(false);
  });

  it("code exchange: returns refresh token + VERIFIED subject; a bad ID token fails the whole connect", async () => {
    const ok = provider(() => ({ status: 200, body: { access_token: "a", refresh_token: "r-1", id_token: idToken({}), scope: GOOGLE_SCOPES.join(" ") } }));
    await expect(ok.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "x", nonce: "n-1" })).resolves.toEqual({ refreshToken: "r-1", subject: "1234567890" });
    await expect(ok.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "x", nonce: "other" })).rejects.toMatchObject({ code: "identity_invalid" });
    const noId = provider(() => ({ status: 200, body: { access_token: "a", refresh_token: "r-1", scope: GOOGLE_SCOPES.join(" ") } }));
    await expect(noId.exchangeCode({ code: "c", codeVerifier: "v", redirectUri: "x", nonce: "n-1" })).rejects.toMatchObject({ code: "identity_invalid" });
  });

  it("identify exchange: subject only, verifier sent in the POST body", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { access_token: "a", id_token: idToken({}), scope: "openid" } }));
    const p = new GoogleCalendarProvider(config, f.impl, jwks, () => NOW);
    await expect(p.exchangeIdentity({ code: "c", codeVerifier: "v", redirectUri: "x", nonce: "n-1" })).resolves.toEqual({ subject: "1234567890" });
    expect(String(f.calls[0].init?.body)).toContain("code_verifier=v");
    expect(f.calls[0].url).not.toContain("secret");
    expect(f.calls.some((c) => c.url.includes("/revoke"))).toBe(false);
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

  it("before migration 0026 (no google_subject_hash column) reads fall back to the old column list", async () => {
    const { createSupabaseExternalCalendarStore } = await import("../store");
    const selected: string[] = [];
    const row = { id: "c1", workspace_id: "ws", staff_id: "s1", provider: "google", status: "connected", calendar_ids: ["a"], busy_intervals: [], created_at: "2026-10-13T00:00:00Z" };
    const fake = {
      from: () => ({
        select: (cols: string) => {
          selected.push(cols);
          const missing = cols.includes("google_subject_hash");
          return { eq: async () => (missing ? { data: null, error: { code: "42703", message: "x" } } : { data: [row], error: null }) };
        },
      }),
    } as never;
    const store = createSupabaseExternalCalendarStore(fake);
    const list = await store.listConnections("ws");
    expect(list).toHaveLength(1);
    expect(list[0].subjectHash).toBeNull();
    expect(selected[1]).not.toContain("google_subject_hash");
    expect(await store.listConnectionsBySubject("a".repeat(64))).toEqual([]);
  });
});
