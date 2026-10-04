import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));

const auth = {
  signUpWithPassword: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => {}),
  getCurrentUserId: vi.fn(async () => null as string | null),
};
vi.mock("@/server/auth/supabaseBusinessAuth", () => ({ getBusinessAuth: () => auth, getCurrentUserSafe: async () => null }));
vi.mock("@/server/booking/deps", () => ({
  getPublicBookingDeps: () => ({
    admin: { from: () => ({ insert: async () => ({ error: null }) }), rpc: async () => ({ data: null, error: null }) },
    rateLimiter: { hit: async () => ({ allowed: true, remaining: 1, retryAfterSeconds: 0 }) },
  }),
}));
vi.mock("@/server/clientAccount/pendingClaims", () => ({ readPendingClaims: async () => [], writePendingClaims: async () => true, appendPendingClaim: async () => true }));

const actions = await import("../clientAccount.actions");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const UID = "11111111-0000-4000-8000-000000000001";

beforeEach(() => {
  redirect.mockClear();
  auth.signInWithPassword.mockReset();
  auth.signUpWithPassword.mockReset();
  auth.getCurrentUserId.mockResolvedValue(null);
});

describe("client auth actions", () => {
  it("sign-in redirects only to a validated /client path (open redirect closed)", async () => {
    auth.signInWithPassword.mockResolvedValue({ ok: true, userId: UID });
    await expect(actions.signInClientAction({}, form({ email: "A@x.test", password: "pw", redirect: "/client/bookings" }))).rejects.toThrow("REDIRECT:/client/bookings");
    await expect(actions.signInClientAction({}, form({ email: "a@x.test", password: "pw", redirect: "https://evil.test" }))).rejects.toThrow("REDIRECT:/client");
    await expect(actions.signInClientAction({}, form({ email: "a@x.test", password: "pw", redirect: "//evil.test" }))).rejects.toThrow("REDIRECT:/client");
    await expect(actions.signInClientAction({}, form({ email: "a@x.test", password: "pw", redirect: "/login" }))).rejects.toThrow("REDIRECT:/client");
    expect(auth.signInWithPassword).toHaveBeenCalledWith("a@x.test", "pw");
  });

  it("returns codes only, never the password or provider text", async () => {
    auth.signInWithPassword.mockResolvedValue({ ok: false, code: "invalid_credentials" });
    const r = await actions.signInClientAction({}, form({ email: "a@x.test", password: "hunter22" }));
    expect(r).toEqual({ error: "invalid_credentials" });
    expect(JSON.stringify(r)).not.toContain("hunter22");
    expect(await actions.signInClientAction({}, form({ email: "nope", password: "x" }))).toEqual({ error: "invalid_input" });
  });

  it("sign-up: neutral check-email (also for an existing address); weak password is a code", async () => {
    auth.signUpWithPassword.mockResolvedValue({ ok: true, userId: UID, hasSession: false });
    expect(await actions.signUpClientAction({}, form({ email: "a@x.test", password: "longenough1" }))).toEqual({ checkEmail: true, email: "a@x.test" });
    auth.signUpWithPassword.mockResolvedValue({ ok: false, code: "email_taken" });
    expect(await actions.signUpClientAction({}, form({ email: "a@x.test", password: "longenough1" }))).toEqual({ checkEmail: true, email: "a@x.test" });
    expect(await actions.signUpClientAction({}, form({ email: "a@x.test", password: "short" }))).toEqual({ error: "weak_password" });
    auth.signUpWithPassword.mockResolvedValue({ ok: true, userId: UID, hasSession: true });
    await expect(actions.signUpClientAction({}, form({ email: "a@x.test", password: "longenough1", redirect: "/client/bookings" }))).rejects.toThrow("REDIRECT:/client/bookings");
  });

  it("sign-out goes to /client", async () => {
    await expect(actions.signOutClientAction()).rejects.toThrow("REDIRECT:/client");
  });
});

describe("my-bookings actions require a verified session", () => {
  it("anonymous -> unauthenticated", async () => {
    const id = "22222222-0000-4000-8000-000000000002";
    expect(await actions.cancelMyBookingAction(id)).toEqual({ ok: false, code: "unauthenticated" });
    expect(await actions.getMyRescheduleSlotsAction(id, "2030-01-01")).toEqual({ ok: false, code: "unauthenticated" });
    expect(await actions.rescheduleMyBookingAction(id, "2030-01-01", "10:00", null)).toEqual({ ok: false, code: "unauthenticated" });
    expect(await actions.claimPendingBookingsAction()).toEqual({ ok: false, code: "unauthenticated" });
  });
  it("signed in with nothing pending -> claimed 0", async () => {
    auth.getCurrentUserId.mockResolvedValue(UID);
    expect(await actions.claimPendingBookingsAction()).toEqual({ ok: true, data: { claimed: 0 } });
  });
});
