import { describe, expect, it } from "vitest";
import { isRecoveryAllowedPath, isRecoveryFlagExpired, newRecoveryFlagValue, RECOVERY_WINDOW_MS } from "../recoveryFlag";

describe("password-reset flag", () => {
  it("is open for exactly the window and expired after it", () => {
    const now = 1_000_000;
    const value = newRecoveryFlagValue(now);
    expect(value).toBe(String(now + RECOVERY_WINDOW_MS));
    expect(isRecoveryFlagExpired(value, now + RECOVERY_WINDOW_MS - 1)).toBe(false);
    expect(isRecoveryFlagExpired(value, now + RECOVERY_WINDOW_MS + 1)).toBe(true);
  });

  it("a missing or garbled value counts as expired", () => {
    expect(isRecoveryFlagExpired(undefined)).toBe(true);
    expect(isRecoveryFlagExpired("abc")).toBe(true);
    expect(isRecoveryFlagExpired("")).toBe(true);
  });

  it("keeps only the reset pages, sign-in and static files reachable", () => {
    for (const p of ["/reset-password", "/reset-password/new", "/reset-password/new/", "/forgot-password", "/login", "/logo.png", "/sw.js"]) {
      expect(isRecoveryAllowedPath(p), p).toBe(true);
    }
    for (const p of ["/", "/my-salon/today", "/client/bookings", "/signup", "/login-help", "/forgot-password/x"]) {
      expect(isRecoveryAllowedPath(p), p).toBe(false);
    }
  });
});
