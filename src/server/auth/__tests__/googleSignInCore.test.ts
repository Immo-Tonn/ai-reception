import { describe, expect, it, vi } from "vitest";
import { finishGoogleOAuth, probeAuthorizeUrl, startGoogleOAuth, type GoogleAuthClient, type GoogleAuthUser } from "../googleSignInCore";

const okProbe = async () => "ok" as const;

const SUPABASE = "https://project.supabase.example";
const REDIRECT = "https://app.example/auth/callback";

function fake(over: Partial<GoogleAuthClient["auth"]> = {}) {
  const auth = {
    signInWithOAuth: vi.fn(async () => ({ data: { url: `${SUPABASE}/auth/v1/authorize?provider=google` }, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { user: googleUser() }, error: null })),
    signOut: vi.fn(async () => ({})),
    ...over,
  } as GoogleAuthClient["auth"];
  return { client: { auth } as GoogleAuthClient, auth };
}
const googleUser = (over: Partial<GoogleAuthUser> = {}): GoogleAuthUser => ({
  id: "11111111-1111-4111-8111-111111111111",
  email: "Person@Example.com",
  email_confirmed_at: "2026-11-01T10:00:00Z",
  identities: [{ provider: "google" }],
  ...over,
});

describe("start Google sign-in", () => {
  it("asks for the Google provider with the configured callback and no automatic browser redirect", async () => {
    const { client, auth } = fake();
    const r = await startGoogleOAuth(client, REDIRECT, SUPABASE, okProbe);
    expect(r).toEqual({ ok: true, url: `${SUPABASE}/auth/v1/authorize?provider=google` });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
  });

  it("a provider that is not enabled yet is reported as unavailable, not as a crash", async () => {
    const { client } = fake({ signInWithOAuth: vi.fn(async () => ({ data: null, error: { message: "Unsupported provider: provider is not enabled" } })) });
    expect(await startGoogleOAuth(client, REDIRECT, SUPABASE, okProbe)).toEqual({ ok: false, code: "google_unavailable" });
  });

  it("never follows an address outside the Supabase project", async () => {
    const { client } = fake({ signInWithOAuth: vi.fn(async () => ({ data: { url: "https://evil.example/phish" }, error: null })) });
    expect(await startGoogleOAuth(client, REDIRECT, SUPABASE, okProbe)).toEqual({ ok: false, code: "google_failed" });
  });

  it("a thrown error becomes a stable code without its message", async () => {
    const { client } = fake({ signInWithOAuth: vi.fn(async () => { throw new Error("secret detail"); }) });
    const r = await startGoogleOAuth(client, REDIRECT, SUPABASE, okProbe);
    expect(r).toEqual({ ok: false, code: "google_failed" });
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});

describe("provider not enabled in Supabase", () => {
  it("a probe that finds no Google redirect makes the answer 'unavailable' (the URL is not handed out)", async () => {
    const { client } = fake();
    expect(await startGoogleOAuth(client, REDIRECT, SUPABASE, async () => "unavailable")).toEqual({ ok: false, code: "google_unavailable" });
  });

  it("probe: a redirect to Google is ok; an error body, a redirect elsewhere or no redirect is unavailable", async () => {
    const res = (status: number, location?: string) => async () => new Response(null, { status, headers: location ? { location } : {} });
    expect(await probeAuthorizeUrl("https://x", res(302, "https://accounts.google.com/o/oauth2/v2/auth?x=1") as unknown as typeof fetch)).toBe("ok");
    expect(await probeAuthorizeUrl("https://x", res(400) as unknown as typeof fetch)).toBe("unavailable");
    expect(await probeAuthorizeUrl("https://x", res(302, "https://evil.example/") as unknown as typeof fetch)).toBe("unavailable");
    expect(await probeAuthorizeUrl("https://x", res(302, "not a url") as unknown as typeof fetch)).toBe("unavailable");
    expect(await probeAuthorizeUrl("https://x", res(200) as unknown as typeof fetch)).toBe("unavailable");
  });

  it("a network failure of the probe is reported as failed, not as a crash", async () => {
    const { client } = fake();
    const r = await startGoogleOAuth(client, REDIRECT, SUPABASE, async () => { throw new Error("boom"); });
    expect(r).toEqual({ ok: false, code: "google_failed" });
  });
});

describe("finish Google sign-in", () => {
  it("accepts a Google identity with a verified e-mail (e-mail normalised)", async () => {
    const { client } = fake();
    expect(await finishGoogleOAuth(client, "code123")).toEqual({ ok: true, userId: "11111111-1111-4111-8111-111111111111", email: "person@example.com" });
  });

  it("an invalid or used code fails without a session", async () => {
    const { client, auth } = fake({ exchangeCodeForSession: vi.fn(async () => ({ data: null, error: { message: "invalid flow state" } })) });
    expect(await finishGoogleOAuth(client, "bad")).toEqual({ ok: false, code: "google_failed" });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("an empty or oversized code is refused before any call", async () => {
    const { client, auth } = fake();
    expect(await finishGoogleOAuth(client, "")).toEqual({ ok: false, code: "google_failed" });
    expect(await finishGoogleOAuth(client, "x".repeat(3000))).toEqual({ ok: false, code: "google_failed" });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("signs out and refuses an unverified e-mail", async () => {
    const { client, auth } = fake({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: googleUser({ email_confirmed_at: null }) }, error: null })) });
    expect(await finishGoogleOAuth(client, "c")).toEqual({ ok: false, code: "google_unverified" });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out and refuses a session that is not a Google identity", async () => {
    for (const identities of [[{ provider: "email" }], [], null]) {
      const { client, auth } = fake({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: googleUser({ identities }) }, error: null })) });
      expect(await finishGoogleOAuth(client, "c")).toEqual({ ok: false, code: "google_unverified" });
      expect(auth.signOut).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses an account that also holds an UNVERIFIED e-mail+password identity (pre-registration takeover)", async () => {
    const identities = [{ provider: "email", identity_data: { email_verified: false } }, { provider: "google" }];
    const { client, auth } = fake({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: googleUser({ identities }) }, error: null })) });
    expect(await finishGoogleOAuth(client, "c")).toEqual({ ok: false, code: "google_unverified" });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("accepts an account that also has a VERIFIED (or unspecified) e-mail+password identity", async () => {
    for (const data of [{ email_verified: true }, undefined, null]) {
      const identities = [{ provider: "email", identity_data: data }, { provider: "google" }];
      const { client } = fake({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: googleUser({ identities }) }, error: null })) });
      expect((await finishGoogleOAuth(client, "c")).ok).toBe(true);
    }
  });

  it("refuses a user without an e-mail address", async () => {
    const { client, auth } = fake({ exchangeCodeForSession: vi.fn(async () => ({ data: { user: googleUser({ email: null }) }, error: null })) });
    expect(await finishGoogleOAuth(client, "c")).toEqual({ ok: false, code: "google_unverified" });
    expect(auth.signOut).toHaveBeenCalled();
  });
});
