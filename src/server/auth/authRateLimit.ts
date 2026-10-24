import "server-only";
import { headers } from "next/headers";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { clientIpFromHeaders, getRateLimiter, type RateLimiter, type RateLimitRule } from "@/server/ratelimit";

/**
 * Brute-force protection for password sign-in and sign-up (business and client).
 *
 * Supabase Auth has its own limits, but every request reaches it from the
 * Vercel servers, so it sees the same few addresses for all users: its per-IP
 * limit either never triggers for one attacker or blocks everyone at once.
 * These limits use the real client address (and, for sign-in, the e-mail),
 * stored only as HMAC by the PostgreSQL limiter.
 *
 * Fail OPEN when the limiter itself is unavailable (no service-role key,
 * database hiccup): Supabase's limits still apply, and an infrastructure
 * problem must not lock every user out.
 */
export const AUTH_RATE_LIMITS = {
  signInIp: { scope: "auth_sign_in_ip", limit: 30, windowSeconds: 10 * 60 },
  signInEmail: { scope: "auth_sign_in_email", limit: 10, windowSeconds: 15 * 60 },
  signUpIp: { scope: "auth_sign_up_ip", limit: 10, windowSeconds: 60 * 60 },
} satisfies Record<string, RateLimitRule>;

export type AuthAttempt = { kind: "sign_in"; email: string } | { kind: "sign_up" };

/** Pure decision for a given limiter and client address (unit-tested). */
export async function checkAuthAttempt(limiter: RateLimiter, ip: string, attempt: AuthAttempt): Promise<boolean> {
  try {
    if (attempt.kind === "sign_up") return (await limiter.hit(AUTH_RATE_LIMITS.signUpIp, ip)).allowed;
    const [byIp, byEmail] = await Promise.all([
      limiter.hit(AUTH_RATE_LIMITS.signInIp, ip),
      limiter.hit(AUTH_RATE_LIMITS.signInEmail, attempt.email.trim().toLowerCase()),
    ]);
    return byIp.allowed && byEmail.allowed;
  } catch (error) {
    console.error("[auth rate limit] limiter unavailable:", error instanceof Error ? error.name : "unknown");
    return true;
  }
}

/** For Server Actions: false = answer "rate_limited" without calling Supabase Auth. */
export async function authAttemptAllowed(attempt: AuthAttempt): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;
  let limiter: RateLimiter;
  try {
    limiter = getRateLimiter();
  } catch (error) {
    console.error("[auth rate limit] limiter not configured:", error instanceof Error ? error.name : "unknown");
    return true;
  }
  const h = await headers();
  return checkAuthAttempt(limiter, clientIpFromHeaders((n) => h.get(n)), attempt);
}
