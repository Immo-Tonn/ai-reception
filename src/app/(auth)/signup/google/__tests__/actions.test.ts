import { beforeEach, describe, expect, it, vi } from "vitest";

class Redirect extends Error {
  constructor(public url: string) {
    super("redirect");
  }
}
const currentUser = vi.fn();
const homeSlug = vi.fn();
const provision = vi.fn();
const allowed = vi.fn();
const signOut = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Redirect(url); } }));
vi.mock("@/lib/i18n/next", () => ({ getRequestLocale: async () => "en" }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) }));
vi.mock("@/server/auth/supabaseBusinessAuth", () => ({
  getCurrentUserSafe: (...a: unknown[]) => currentUser(...a),
  getBusinessAuth: () => ({ signOut: (...a: unknown[]) => signOut(...a) }),
}));
vi.mock("@/server/auth/ownerHome", () => ({ findOwnerHomeSlug: (...a: unknown[]) => homeSlug(...a) }));
vi.mock("@/server/auth/authRateLimit", () => ({ authAttemptAllowed: (...a: unknown[]) => allowed(...a) }));
vi.mock("@/server/services/provisioning.service", () => ({ provisionOwnerWorkspace: (...a: unknown[]) => provision(...a) }));

const { completeGoogleSignUpAction, cancelGoogleSignUpAction } = await import("../actions");

const form = (businessName: string, extra: Record<string, string> = {}) => {
  const f = new FormData();
  f.set("businessName", businessName);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
};
const run = async (fn: () => Promise<unknown>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Redirect) return `redirect:${e.url}`;
    throw e;
  }
};

beforeEach(() => {
  for (const m of [currentUser, homeSlug, provision, allowed, signOut]) m.mockReset();
  currentUser.mockResolvedValue({ id: "user-1", email: "Owner@Example.com" });
  homeSlug.mockResolvedValue(null);
  allowed.mockResolvedValue(true);
  provision.mockResolvedValue({ ok: true, workspaceSlug: "my-salon" });
});

describe("completeGoogleSignUpAction", () => {
  it("creates the workspace for the signed-in person and goes to onboarding", async () => {
    expect(await run(() => completeGoogleSignUpAction({}, form("My Salon")))).toBe("redirect:/onboarding/my-salon");
    expect(provision).toHaveBeenCalledWith({ userId: "user-1", email: "owner@example.com", businessName: "My Salon", locale: "en" });
  });

  it("takes identity from the session, never from the form", async () => {
    await run(() => completeGoogleSignUpAction({}, form("My Salon", { userId: "attacker", email: "attacker@evil.example" })));
    expect(provision.mock.calls[0][0]).toMatchObject({ userId: "user-1", email: "owner@example.com" });
  });

  it("without a session goes to the sign-in page and creates nothing", async () => {
    currentUser.mockResolvedValue(null);
    expect(await run(() => completeGoogleSignUpAction({}, form("X")))).toBe("redirect:/login");
    expect(provision).not.toHaveBeenCalled();
  });

  it("a person who already has a workspace gets no second one", async () => {
    homeSlug.mockResolvedValue("existing");
    expect(await run(() => completeGoogleSignUpAction({}, form("Another")))).toBe("redirect:/existing/today");
    expect(provision).not.toHaveBeenCalled();
  });

  it("rejects an empty or overlong name and hands the typed text back", async () => {
    expect(await completeGoogleSignUpAction({}, form("   "))).toEqual({ error: "invalid_input", businessName: "" });
    const long = "x".repeat(130);
    const r = (await completeGoogleSignUpAction({}, form(long))) as { error?: string; businessName?: string };
    expect(r.error).toBe("invalid_input");
    expect(r.businessName).toHaveLength(120);
    expect(provision).not.toHaveBeenCalled();
  });

  it("is rate limited", async () => {
    allowed.mockResolvedValue(false);
    expect(await completeGoogleSignUpAction({}, form("My Salon"))).toEqual({ error: "rate_limited", businessName: "My Salon" });
    expect(provision).not.toHaveBeenCalled();
  });

  it("a failed provisioning is an error, and the account is NOT deleted", async () => {
    provision.mockResolvedValue({ ok: false, code: "unknown" });
    expect(await completeGoogleSignUpAction({}, form("My Salon"))).toEqual({ error: "unknown", businessName: "My Salon" });
  });
});

describe("cancelGoogleSignUpAction", () => {
  it("signs out and returns to the sign-in page", async () => {
    expect(await run(() => cancelGoogleSignUpAction())).toBe("redirect:/login");
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
