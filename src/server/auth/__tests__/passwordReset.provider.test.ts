import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
};
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/config", () => ({ isSupabaseConfigured: () => true }));

const { requestPasswordResetCode, verifyPasswordResetCode, completePasswordReset } = await import("../supabaseBusinessAuth");

beforeEach(() => {
  auth.resetPasswordForEmail.mockReset();
  auth.verifyOtp.mockReset();
  auth.updateUser.mockReset();
  auth.signOut.mockClear();
});

describe("requestPasswordResetCode", () => {
  it("answers ok when the code was sent", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    await expect(requestPasswordResetCode("a@x.test")).resolves.toEqual({ ok: true });
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("a@x.test");
  });

  it("looks the same for any other failure (no hint whether the address has an account)", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { code: "unexpected_failure", status: 500 } });
    await expect(requestPasswordResetCode("a@x.test")).resolves.toEqual({ ok: true });
  });

  it("only a rate limit is reported", async () => {
    auth.resetPasswordForEmail.mockResolvedValue({ error: { code: "over_email_send_rate_limit", status: 429 } });
    await expect(requestPasswordResetCode("a@x.test")).resolves.toEqual({ ok: false, code: "rate_limited" });
  });
});

describe("verifyPasswordResetCode", () => {
  it("a correct code opens a session (recovery OTP)", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    await expect(verifyPasswordResetCode("a@x.test", "123456")).resolves.toEqual({ ok: true });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "a@x.test", token: "123456", type: "recovery" });
  });

  it("a wrong or expired code is ONE answer: invalid_code", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { code: "otp_expired", status: 403 } });
    await expect(verifyPasswordResetCode("a@x.test", "123456")).resolves.toEqual({ ok: false, code: "invalid_code" });
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(verifyPasswordResetCode("a@x.test", "123456")).resolves.toEqual({ ok: false, code: "invalid_code" });
  });

  it("separates a rate limit and a server failure from a wrong code", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { code: "over_request_rate_limit", status: 429 } });
    await expect(verifyPasswordResetCode("a@x.test", "123456")).resolves.toEqual({ ok: false, code: "rate_limited" });
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { code: "unexpected_failure", status: 500 } });
    await expect(verifyPasswordResetCode("a@x.test", "123456")).resolves.toEqual({ ok: false, code: "unknown" });
  });
});

describe("completePasswordReset", () => {
  it("sets the password, then ends ALL sessions", async () => {
    auth.updateUser.mockResolvedValue({ error: null });
    await expect(completePasswordReset("new-password-1")).resolves.toEqual({ ok: true });
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password-1" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("an unchanged password and a weak password come back as codes; nobody is signed out", async () => {
    auth.updateUser.mockResolvedValue({ error: { code: "same_password", status: 422 } });
    await expect(completePasswordReset("old-password")).resolves.toEqual({ ok: false, code: "same_password" });
    auth.updateUser.mockResolvedValue({ error: { code: "weak_password", status: 422 } });
    await expect(completePasswordReset("short")).resolves.toEqual({ ok: false, code: "weak_password" });
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
