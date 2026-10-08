import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RateLimitDecision, RateLimiter, RateLimitRule } from "./rateLimiter";

/**
 * PostgreSQL implementation (`public.rate_limit_hit`, migration 0014).
 * Counters live in the shared database, so the limit holds across serverless
 * instances. Only an HMAC of the subject is sent/stored — keyed with a
 * server-side secret, so an IP address or e-mail cannot be read back or
 * brute-forced from the table. Fails CLOSED: if the limiter cannot be reached
 * the call throws and the guarded operation does not run.
 */
export function createPostgresRateLimiter(client: SupabaseClient, secret: string): RateLimiter {
  return {
    async hit(rule: RateLimitRule, subject: string): Promise<RateLimitDecision> {
      const keyHash = createHmac("sha256", secret).update(`${rule.scope}:${subject}`).digest("hex");
      const { data, error } = await client.rpc("rate_limit_hit", {
        p_scope: rule.scope,
        p_key_hash: keyHash,
        p_limit: rule.limit,
        p_window_seconds: rule.windowSeconds,
      });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row) throw new Error("rate limiter unavailable");
      return {
        allowed: row.allowed === true,
        remaining: Number(row.remaining),
        retryAfterSeconds: Number(row.retry_after_seconds),
      };
    },
  };
}
