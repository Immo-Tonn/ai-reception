import type { RateLimitDecision, RateLimiter, RateLimitRule } from "./rateLimiter";

/**
 * TESTS / LOCAL EXPERIMENTS ONLY. Counters live in this process's memory, so
 * on a serverless host every instance would have its own — that protects
 * nothing. Production uses `postgresRateLimiter`.
 */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const counters = new Map<string, number>();
  return {
    async hit(rule: RateLimitRule, subject: string): Promise<RateLimitDecision> {
      const windowMs = rule.windowSeconds * 1000;
      const windowStart = Math.floor(now() / windowMs) * windowMs;
      const key = `${rule.scope}|${subject}|${windowStart}`;
      const hits = (counters.get(key) ?? 0) + 1;
      counters.set(key, hits);
      const allowed = hits <= rule.limit;
      return {
        allowed,
        remaining: Math.max(rule.limit - hits, 0),
        retryAfterSeconds: allowed ? 0 : Math.ceil((windowStart + windowMs - now()) / 1000),
      };
    },
  };
}
