import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/server/auth/session", () => ({ getSession: (slug: string) => getSession(slug) }));
const changePassword = vi.fn();
vi.mock("@/server/auth/supabaseBusinessAuth", () => ({
  changePassword: (current: string, next: string) => changePassword(current, next),
}));

const { changePasswordAction } = await import("../account.actions");

beforeEach(() => {
  getSession.mockReset().mockResolvedValue({ userId: "u1", workspaceId: "w1", role: "owner" });
  changePassword.mockReset().mockResolvedValue({ ok: true });
});

describe("changePasswordAction", () => {
  it("re-checks the current password server-side and passes both passwords on", async () => {
    await expect(changePasswordAction("acme", "old-password", "new-password-1")).resolves.toEqual({ ok: true });
    expect(getSession).toHaveBeenCalledWith("acme");
    expect(changePassword).toHaveBeenCalledWith("old-password", "new-password-1");
  });

  it("a wrong current password comes back as a code and nothing else", async () => {
    changePassword.mockResolvedValue({ ok: false, code: "invalid_credentials" });
    await expect(changePasswordAction("acme", "nope", "new-password-1")).resolves.toEqual({
      ok: false,
      code: "invalid_credentials",
    });
  });

  it("refuses a new password outside 8-72 characters without calling the provider", async () => {
    await expect(changePasswordAction("acme", "old-password", "short")).resolves.toEqual({ ok: false, code: "weak_password" });
    await expect(changePasswordAction("acme", "old-password", "x".repeat(73))).resolves.toEqual({
      ok: false,
      code: "weak_password",
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("refuses an empty current password and an unchanged password", async () => {
    await expect(changePasswordAction("acme", "", "new-password-1")).resolves.toEqual({ ok: false, code: "invalid_input" });
    await expect(changePasswordAction("acme", "same-password", "same-password")).resolves.toEqual({
      ok: false,
      code: "invalid_input",
    });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("needs a session for that workspace: no session, no password change", async () => {
    getSession.mockRejectedValue(new Error("no session"));
    await expect(changePasswordAction("acme", "old-password", "new-password-1")).resolves.toEqual({ ok: false, code: "unknown" });
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("an unexpected provider failure becomes a generic code (no message leaks)", async () => {
    changePassword.mockRejectedValue(new Error("db password=secret"));
    const result = await changePasswordAction("acme", "old-password", "new-password-1");
    expect(result).toEqual({ ok: false, code: "unknown" });
  });
});
