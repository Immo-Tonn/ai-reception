import { AuthClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { startGoogleOAuth, type GoogleAuthClient } from "../googleSignInCore";

/**
 * Real GoTrue (local Docker Supabase, dummy Google credentials) — SKIPPED unless a LOCAL stack is
 * given. Shows that the authorize probe tells an enabled Google provider from a disabled one and
 * that a disabled provider never hands out a URL.
 *   LOCAL_SUPABASE_API_URL=http://127.0.0.1:54321 LOCAL_SUPABASE_ANON_KEY=… LOCAL_GOOGLE_PROVIDER=off|on
 */
const API = process.env.LOCAL_SUPABASE_API_URL ?? "";
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY ?? "";
const STATE = process.env.LOCAL_GOOGLE_PROVIDER ?? "";
const enabled = Boolean(API && ANON && (STATE === "on" || STATE === "off"));
if (enabled && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) throw new Error("LOCAL_SUPABASE_API_URL must be a local address");

describe.skipIf(!enabled)(`Google provider against a real local GoTrue (provider ${STATE})${enabled ? "" : " — SKIPPED"}`, { timeout: 30_000 }, () => {
  // The Auth client alone (the full client needs a WebSocket the test runtime may not have).
  const client = () =>
    ({
      auth: new AuthClient({ url: `${API}/auth/v1`, headers: { apikey: ANON, Authorization: `Bearer ${ANON}` }, flowType: "pkce", persistSession: false, autoRefreshToken: false }),
    }) as unknown as GoogleAuthClient;

  it(STATE === "on" ? "hands out the authorize URL (redirects to Google)" : "does not hand out a URL while the provider is off", async () => {
    const r = await startGoogleOAuth(client(), "http://127.0.0.1:3000/auth/callback", API);
    if (STATE === "on") {
      expect(r.ok).toBe(true);
      if (r.ok) expect(new URL(r.url).origin).toBe(new URL(API).origin);
    } else {
      expect(r).toEqual({ ok: false, code: "google_unavailable" });
    }
  });

  it("a bad one-time code never creates a session", async () => {
    const { finishGoogleOAuth } = await import("../googleSignInCore");
    expect(await finishGoogleOAuth(client(), "not-a-real-code")).toEqual({ ok: false, code: "google_failed" });
  });
});
