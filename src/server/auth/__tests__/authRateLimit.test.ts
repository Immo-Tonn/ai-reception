import { describe, expect, it } from "vitest";
import { createMemoryRateLimiter } from "@/server/ratelimit/memoryRateLimiter";
import type { RateLimiter } from "@/server/ratelimit/rateLimiter";
import { AUTH_RATE_LIMITS, checkAuthAttempt } from "../authRateLimit";

const signIn = (email: string) => ({ kind: "sign_in" as const, email });

describe("auth brute-force limits", () => {
  it("blocks the 11th sign-in for one e-mail within 15 minutes, even from different addresses", async () => {
    const limiter = createMemoryRateLimiter(() => 0);
    for (let i = 0; i < AUTH_RATE_LIMITS.signInEmail.limit; i++) {
      expect(await checkAuthAttempt(limiter, `10.0.0.${i}`, signIn("Owner@Example.test"))).toBe(true);
    }
    // Same address, different case / spaces: still the same account.
    expect(await checkAuthAttempt(limiter, "10.0.1.1", signIn(" owner@example.test "))).toBe(false);
    // Another account is not affected.
    expect(await checkAuthAttempt(limiter, "10.0.1.1", signIn("someone@example.test"))).toBe(true);
  });

  it("blocks one address that tries many accounts", async () => {
    const limiter = createMemoryRateLimiter(() => 0);
    for (let i = 0; i < AUTH_RATE_LIMITS.signInIp.limit; i++) {
      expect(await checkAuthAttempt(limiter, "203.0.113.7", signIn(`user${i}@example.test`))).toBe(true);
    }
    expect(await checkAuthAttempt(limiter, "203.0.113.7", signIn("next@example.test"))).toBe(false);
    expect(await checkAuthAttempt(limiter, "203.0.113.8", signIn("next@example.test"))).toBe(true);
  });

  it("limits sign-ups per address per hour, and the window resets", async () => {
    let now = 0;
    const limiter = createMemoryRateLimiter(() => now);
    for (let i = 0; i < AUTH_RATE_LIMITS.signUpIp.limit; i++) {
      expect(await checkAuthAttempt(limiter, "198.51.100.1", { kind: "sign_up" })).toBe(true);
    }
    expect(await checkAuthAttempt(limiter, "198.51.100.1", { kind: "sign_up" })).toBe(false);
    now += AUTH_RATE_LIMITS.signUpIp.windowSeconds * 1000 + 1;
    expect(await checkAuthAttempt(limiter, "198.51.100.1", { kind: "sign_up" })).toBe(true);
  });

  it("fails open when the limiter itself is down (Supabase limits still apply)", async () => {
    const broken: RateLimiter = { hit: async () => { throw new Error("rate limiter unavailable"); } };
    expect(await checkAuthAttempt(broken, "192.0.2.1", signIn("a@example.test"))).toBe(true);
    expect(await checkAuthAttempt(broken, "192.0.2.1", { kind: "sign_up" })).toBe(true);
  });
});
