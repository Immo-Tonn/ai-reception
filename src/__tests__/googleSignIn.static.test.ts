import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guarantees for Google sign-in: the app never holds a Google key or token (Supabase does),
 * never builds the callback from request data, and never echoes provider text.
 */
const root = path.resolve(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? (n === "node_modules" || n === ".next" ? [] : walk(p)) : [p];
  });
const sources = walk(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes("__tests__"));
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => path.relative(root, f);

describe("Google sign-in (static)", () => {
  it("no Google client id/secret or id-token flow in the sign-in code (the keys live in the Supabase dashboard)", () => {
    const googleLogin = sources.filter((f) => /googleSignIn|googleAuth|googleLogin|auth\/callback|GoogleButton|signup\/google/.test(rel(f)));
    expect(googleLogin.length).toBeGreaterThanOrEqual(6);
    for (const f of googleLogin) {
      const text = read(f);
      expect(text, rel(f)).not.toMatch(/GOOGLE_CLIENT|GOOGLE_CALENDAR_CLIENT|client_secret|signInWithIdToken|SERVICE_ROLE/i);
    }
  });

  it("the sign-in feature does not touch the Google Calendar integration", () => {
    for (const f of sources.filter((f) => /googleSignIn|googleAuth\.actions|googleLogin|auth\/callback\/route|GoogleButton/.test(rel(f)))) {
      expect(read(f), rel(f)).not.toMatch(/externalCalendar|google-calendar|connect-calendar/);
    }
  });

  it("the callback never echoes provider error text", () => {
    const route = read(path.join(root, "src/app/auth/callback/route.ts"));
    expect(route).not.toMatch(/error_description/);
  });

  it("the callback address comes from the configured public URL, not from request headers", () => {
    const action = read(path.join(root, "src/server/actions/googleAuth.actions.ts"));
    expect(action).toMatch(/getPublicBaseUrl/);
    expect(action).not.toMatch(/x-forwarded|origin\b.*headers/i);
  });

  it("the feature switch is server-side only (no NEXT_PUBLIC_ variable)", () => {
    for (const f of sources) expect(read(f), rel(f)).not.toMatch(/NEXT_PUBLIC_GOOGLE/);
  });
});
