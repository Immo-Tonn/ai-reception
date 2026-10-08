import "server-only";
import { createSupabaseAdminClient, deriveServerSecret } from "@/lib/supabase/admin";
import { createPostgresRateLimiter } from "./postgresRateLimiter";
import type { RateLimiter } from "./rateLimiter";

export * from "./rateLimiter";

/** The production limiter: PostgreSQL, shared by all server instances. */
export function getRateLimiter(): RateLimiter {
  return createPostgresRateLimiter(createSupabaseAdminClient(), deriveServerSecret("rate-limit"));
}
