import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));
const createServerClient = vi.fn(() => ({ auth: { getUser } }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));

const { proxy, config } = await import("../proxy");

const withEnv = () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
};
const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost${path}`, { headers: cookie ? { cookie } : {} });

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  createServerClient.mockClear();
  getUser.mockClear();
});

describe("proxy (session refresh)", () => {
  it("does nothing — and cannot fail — when Supabase is not configured", async () => {
    const res = await proxy(request("/anything", "sb-x-auth-token=1"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("costs anonymous visitors nothing: no auth cookie -> no Supabase call", async () => {
    withEnv();
    await proxy(request("/demo-salon/today"));
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("refreshes the session for a signed-in browser", async () => {
    withEnv();
    await proxy(request("/my-salon/today", "sb-proj-auth-token=abc"));
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("a Supabase outage never breaks the page", async () => {
    withEnv();
    getUser.mockImplementationOnce(async () => {
      throw new Error("down");
    });
    const res = await proxy(request("/my-salon/today", "sb-proj-auth-token=abc"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("proxy matcher", () => {
  const re = new RegExp("^" + config.matcher[0] + "$");
  it("skips public booking, embeds and assets", () => {
    for (const p of ["/book/demo-salon", "/book/demo-salon/embed", "/embed.js", "/embed-demo", "/_next/static/x.js", "/favicon.ico", "/icons/a.png", "/business"]) {
      expect(re.test(p), p).toBe(false);
    }
  });
  it("still covers workspace pages — including slugs that merely START with a skipped word", () => {
    for (const p of ["/my-salon/today", "/bookkeeping-pro/calendar", "/clients-first/today", "/login", "/onboarding/my-salon", "/client", "/client/bookings", "/client/sign-in"]) {
      expect(re.test(p), p).toBe(true);
    }
  });
});
