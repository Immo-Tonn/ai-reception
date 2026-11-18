import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(public url: string) {
    super("redirect");
  }
}
const cookieSet = vi.fn();
const start = vi.fn();
const allowed = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: cookieSet }),
  headers: async () => new Headers({ host: "app.example" }),
}));
vi.mock("@/server/auth/googleSignIn", () => ({ startGoogleSignIn: (...a: unknown[]) => start(...a) }));
vi.mock("@/server/auth/authRateLimit", () => ({ authAttemptAllowed: (...a: unknown[]) => allowed(...a) }));

const { startGoogleSignInAction } = await import("../googleAuth.actions");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const run = async (fields: Record<string, string>) => {
  try {
    await startGoogleSignInAction(form(fields));
    return "no redirect";
  } catch (e) {
    if (e instanceof Redirect) return e.url;
    throw e;
  }
};

beforeEach(() => {
  cookieSet.mockReset();
  start.mockReset();
  allowed.mockReset();
  process.env.GOOGLE_LOGIN_ENABLED = "true";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  allowed.mockResolvedValue(true);
  start.mockResolvedValue({ ok: true, url: "https://project.supabase.example/auth/v1/authorize?provider=google" });
});

describe("startGoogleSignInAction", () => {
  it("sends the person to the Supabase authorize URL and stores the context in an httpOnly cookie", async () => {
    expect(await run({ intent: "owner" })).toBe("https://project.supabase.example/auth/v1/authorize?provider=google");
    expect(start).toHaveBeenCalledWith("https://app.example/auth/callback");
    expect(cookieSet).toHaveBeenCalledWith("sos_google_ctx", "owner|", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 }));
  });

  it("builds the callback from the configured address, not from request data", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://livetermin.example";
    await run({ intent: "owner", host: "evil.example" });
    expect(start).toHaveBeenCalledWith("https://livetermin.example/auth/callback");
  });

  it("client: remembers a safe return path, replaces a forged one", async () => {
    await run({ intent: "client", next: "/client/profile" });
    expect(cookieSet.mock.calls[0][1]).toBe(`client|${encodeURIComponent("/client/profile")}`);
    cookieSet.mockClear();
    await run({ intent: "client", next: "https://evil.example" });
    expect(cookieSet.mock.calls[0][1]).toBe(`client|${encodeURIComponent("/client/bookings")}`);
  });

  it("an unknown intent is treated as owner", async () => {
    await run({ intent: "admin", next: "/x" });
    expect(cookieSet.mock.calls[0][1]).toBe("owner|");
  });

  it("is refused while the feature is switched off (no Supabase call, no cookie)", async () => {
    process.env.GOOGLE_LOGIN_ENABLED = "";
    expect(await run({ intent: "owner" })).toBe("/login?google=google_unavailable");
    expect(await run({ intent: "client" })).toMatch(/^\/client\/login\?redirect=.*&google=google_unavailable$/);
    expect(start).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    allowed.mockResolvedValue(false);
    expect(await run({ intent: "owner" })).toBe("/login?google=rate_limited");
    expect(start).not.toHaveBeenCalled();
  });

  it("without a public address configured it does not guess one", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.VERCEL_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const prev = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");
    expect(await run({ intent: "owner" })).toBe("/login?google=google_unavailable");
    vi.stubEnv("NODE_ENV", prev ?? "test");
  });

  it("a provider that is not enabled yet returns to the page with 'unavailable'", async () => {
    start.mockResolvedValue({ ok: false, code: "google_unavailable" });
    expect(await run({ intent: "owner" })).toBe("/login?google=google_unavailable");
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
