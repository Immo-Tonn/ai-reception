import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const finish = vi.fn();
const home = vi.fn();
vi.mock("@/server/auth/googleSignIn", () => ({ finishGoogleSignIn: (...a: unknown[]) => finish(...a) }));
vi.mock("@/server/auth/ownerHome", () => ({ findOwnerHomeSlug: (...a: unknown[]) => home(...a) }));

const { GET } = await import("../route");

const ORIGIN = "https://app.example";
const call = (query: string, cookie?: string) =>
  GET(new NextRequest(`${ORIGIN}/auth/callback${query}`, { headers: { host: "app.example", ...(cookie ? { cookie: `sos_google_ctx=${cookie}` } : {}) } }));
const where = (r: Response) => new URL(r.headers.get("location") ?? "", ORIGIN);

beforeEach(() => {
  finish.mockReset();
  home.mockReset();
  process.env.GOOGLE_LOGIN_ENABLED = "true";
  process.env.NEXT_PUBLIC_APP_URL = ORIGIN;
  finish.mockResolvedValue({ ok: true, userId: "u1", email: "a@b.c", supabase: {} });
  home.mockResolvedValue("salon-anna");
});

describe("GET /auth/callback", () => {
  it("owner with a workspace goes to Today; the context cookie is cleared and nothing is cached", async () => {
    const r = await call("?code=abc", "owner|");
    expect(r.status).toBe(303);
    expect(where(r).pathname).toBe("/salon-anna/today");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("set-cookie")).toMatch(/sos_google_ctx=;/);
    expect(finish).toHaveBeenCalledWith("abc");
  });

  it("owner without a workspace finishes sign-up first", async () => {
    home.mockResolvedValue(null);
    expect(where(await call("?code=abc", "owner|")).pathname).toBe("/signup/google");
  });

  it("without any cookie the person is treated as an owner", async () => {
    expect(where(await call("?code=abc")).pathname).toBe("/salon-anna/today");
  });

  it("client goes to the validated return path and no workspace lookup happens", async () => {
    const r = await call("?code=abc", `client|${encodeURIComponent("/client/profile")}`);
    expect(where(r).pathname).toBe("/client/profile");
    expect(home).not.toHaveBeenCalled();
  });

  it("a forged return path in the cookie can never leave /client", async () => {
    const r = await call("?code=abc", `client|${encodeURIComponent("https://evil.example/steal")}`);
    expect(where(r).origin).toBe(ORIGIN);
    expect(where(r).pathname).toBe("/client/bookings");
  });

  it("a return path in the URL is ignored", async () => {
    const r = await call("?code=abc&next=https://evil.example&redirect=/admin", `client|${encodeURIComponent("/client/book")}`);
    expect(where(r).pathname).toBe("/client/book");
  });

  it("the person cancelling at Google goes back with a stable code (owner and client)", async () => {
    expect(where(await call("?error=access_denied", "owner|")).search).toBe("?google=google_cancelled");
    expect(where(await call("?error=access_denied", "owner|")).pathname).toBe("/login");
    const c = where(await call("?error=access_denied", "client|%2Fclient%2Fbook"));
    expect(c.pathname).toBe("/client/login");
    expect(c.searchParams.get("google")).toBe("google_cancelled");
    expect(c.searchParams.get("redirect")).toBe("/client/book");
    expect(finish).not.toHaveBeenCalled();
  });

  it("other provider errors and a missing code are 'failed'; provider text is never echoed", async () => {
    const e = await call("?error=server_error&error_description=SECRET+TEXT", "owner|");
    expect(where(e).search).toBe("?google=google_failed");
    expect(e.headers.get("location")).not.toMatch(/SECRET/);
    expect(where(await call("", "owner|")).search).toBe("?google=google_failed");
  });

  it("a failed exchange or an unverified e-mail goes back with its code", async () => {
    finish.mockResolvedValueOnce({ ok: false, code: "google_failed" });
    expect(where(await call("?code=bad", "owner|")).search).toBe("?google=google_failed");
    finish.mockResolvedValueOnce({ ok: false, code: "google_unverified" });
    expect(where(await call("?code=ok", "owner|")).search).toBe("?google=google_unverified");
  });

  it("while the feature is off nothing is exchanged", async () => {
    process.env.GOOGLE_LOGIN_ENABLED = "false";
    const r = await call("?code=abc", "owner|");
    expect(where(r).search).toBe("?google=google_unavailable");
    expect(finish).not.toHaveBeenCalled();
  });
});
