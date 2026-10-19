import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
const store = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
  set: vi.fn((name: string, value: string, options?: unknown) => {
    void options;
    jar.set(name, value);
  }),
  delete: vi.fn((name: string) => void jar.delete(name)),
};
vi.mock("next/headers", () => ({ cookies: async () => store }));
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const provider = {
  requestPasswordResetCode: vi.fn(),
  verifyPasswordResetCode: vi.fn(),
  completePasswordReset: vi.fn(),
  getCurrentUserSafe: vi.fn(),
  signOut: vi.fn(async () => {}),
};
vi.mock("@/server/auth/supabaseBusinessAuth", () => ({
  requestPasswordResetCode: (e: string) => provider.requestPasswordResetCode(e),
  verifyPasswordResetCode: (e: string, c: string) => provider.verifyPasswordResetCode(e, c),
  completePasswordReset: (p: string) => provider.completePasswordReset(p),
  getCurrentUserSafe: () => provider.getCurrentUserSafe(),
  getBusinessAuth: () => ({ signOut: provider.signOut }),
}));

const actions = await import("../passwordReset.actions");
const { RECOVERY_FLAG_COOKIE } = await import("@/lib/auth/recoveryFlag");

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeEach(() => {
  jar.clear();
  store.set.mockClear();
  store.delete.mockClear();
  redirect.mockClear();
  provider.requestPasswordResetCode.mockReset();
  provider.verifyPasswordResetCode.mockReset();
  provider.completePasswordReset.mockReset();
  provider.getCurrentUserSafe.mockReset().mockResolvedValue({ id: "u1", email: "a@x.test" });
  provider.signOut.mockClear();
});

describe("step 1: request a code", () => {
  it("rejects a malformed address without calling the provider", async () => {
    await expect(actions.requestPasswordResetAction({}, form({ email: "nope" }))).resolves.toEqual({ error: "invalid_input", email: "nope" });
    expect(provider.requestPasswordResetCode).not.toHaveBeenCalled();
  });

  it("sends the code (address lower-cased) and moves on to the code page", async () => {
    provider.requestPasswordResetCode.mockResolvedValue({ ok: true });
    await expect(actions.requestPasswordResetAction({}, form({ email: " A@X.test " }))).rejects.toThrow("REDIRECT:/reset-password?email=a%40x.test");
    expect(provider.requestPasswordResetCode).toHaveBeenCalledWith("a@x.test");
  });

  it("a rate limit stays on the page", async () => {
    provider.requestPasswordResetCode.mockResolvedValue({ ok: false, code: "rate_limited" });
    await expect(actions.requestPasswordResetAction({}, form({ email: "a@x.test" }))).resolves.toEqual({ error: "rate_limited", email: "a@x.test" });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("step 2: check the code", () => {
  it("a code that is not digits never reaches the provider", async () => {
    await expect(actions.verifyResetCodeAction({}, form({ email: "a@x.test", code: "12ab56" }))).resolves.toEqual({ error: "invalid_code", email: "a@x.test" });
    expect(provider.verifyPasswordResetCode).not.toHaveBeenCalled();
  });

  it("a wrong code sets no flag", async () => {
    provider.verifyPasswordResetCode.mockResolvedValue({ ok: false, code: "invalid_code" });
    await expect(actions.verifyResetCodeAction({}, form({ email: "a@x.test", code: "123456" }))).resolves.toEqual({ error: "invalid_code", email: "a@x.test" });
    expect(store.set).not.toHaveBeenCalled();
  });

  it("a correct code (spaces ignored) starts the strict window: httpOnly flag, then the new-password page", async () => {
    provider.verifyPasswordResetCode.mockResolvedValue({ ok: true });
    await expect(actions.verifyResetCodeAction({}, form({ email: "a@x.test", code: "123 456" }))).rejects.toThrow("REDIRECT:/reset-password/new");
    expect(provider.verifyPasswordResetCode).toHaveBeenCalledWith("a@x.test", "123456");
    const [name, , options] = store.set.mock.calls[0];
    expect(name).toBe(RECOVERY_FLAG_COOKIE);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});

describe("step 3: the new password", () => {
  const open = () => jar.set(RECOVERY_FLAG_COOKIE, String(Date.now() + 60_000));

  it("without the flag or without a session the person is sent back to the start", async () => {
    await expect(actions.setNewPasswordAction({}, form({ password: "new-password-1", confirm: "new-password-1" }))).rejects.toThrow("REDIRECT:/forgot-password");
    open();
    provider.getCurrentUserSafe.mockResolvedValue(null);
    await expect(actions.setNewPasswordAction({}, form({ password: "new-password-1", confirm: "new-password-1" }))).rejects.toThrow("REDIRECT:/forgot-password");
    expect(provider.completePasswordReset).not.toHaveBeenCalled();
  });

  it("after the window: signed out, flag removed, password NOT set", async () => {
    jar.set(RECOVERY_FLAG_COOKIE, String(Date.now() - 1));
    await expect(actions.setNewPasswordAction({}, form({ password: "new-password-1", confirm: "new-password-1" }))).rejects.toThrow("REDIRECT:/forgot-password?expired=1");
    expect(provider.signOut).toHaveBeenCalled();
    expect(store.delete).toHaveBeenCalledWith(RECOVERY_FLAG_COOKIE);
    expect(provider.completePasswordReset).not.toHaveBeenCalled();
  });

  it("refuses a short or mismatching password and keeps the flag", async () => {
    open();
    await expect(actions.setNewPasswordAction({}, form({ password: "short", confirm: "short" }))).resolves.toEqual({ error: "weak_password" });
    await expect(actions.setNewPasswordAction({}, form({ password: "new-password-1", confirm: "other-password" }))).resolves.toEqual({ error: "password_mismatch" });
    expect(provider.completePasswordReset).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("passes provider codes through (same password) and keeps the flag", async () => {
    open();
    provider.completePasswordReset.mockResolvedValue({ ok: false, code: "same_password" });
    await expect(actions.setNewPasswordAction({}, form({ password: "new-password-1", confirm: "new-password-1" }))).resolves.toEqual({ error: "same_password" });
    expect(store.delete).not.toHaveBeenCalled();
  });

  it("success removes the flag and sends the person to sign in with the new password", async () => {
    open();
    provider.completePasswordReset.mockResolvedValue({ ok: true });
    await expect(actions.setNewPasswordAction({}, form({ password: "new-password-1", confirm: "new-password-1" }))).rejects.toThrow("REDIRECT:/login?reset=done");
    expect(provider.completePasswordReset).toHaveBeenCalledWith("new-password-1");
    expect(store.delete).toHaveBeenCalledWith(RECOVERY_FLAG_COOKIE);
  });
});

describe("cancel", () => {
  it("ends the session, removes the flag and returns to the start", async () => {
    jar.set(RECOVERY_FLAG_COOKIE, String(Date.now() + 60_000));
    await expect(actions.cancelPasswordResetAction()).rejects.toThrow("REDIRECT:/forgot-password");
    expect(provider.signOut).toHaveBeenCalled();
    expect(store.delete).toHaveBeenCalledWith(RECOVERY_FLAG_COOKIE);
  });
});
