/**
 * Provider-independent rate-limiting boundary. Application code depends on
 * THIS interface; the production implementation is PostgreSQL
 * (`postgresRateLimiter.ts`, shared by every server instance). The in-memory
 * one exists only for unit tests / local experiments and is never what
 * `getRateLimiter()` returns.
 *
 * `subject` is whatever is being limited (an IP address, a contact e-mail).
 * Implementations must NOT persist it in clear text.
 */
export interface RateLimitRule {
  /** Short stable name, e.g. "public_booking_ip". */
  scope: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(rule: RateLimitRule, subject: string): Promise<RateLimitDecision>;
}

/** First hop of `x-forwarded-for` (set by the hosting proxy), else `x-real-ip`, else "unknown". */
export function clientIpFromHeaders(get: (name: string) => string | null): string {
  const forwarded = get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || get("x-real-ip")?.trim() || "unknown";
}
