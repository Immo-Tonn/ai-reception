import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRateLimiter } from "@/server/ratelimit";
import type { PublicBookingDeps } from "./publicBooking.service";
import { getExternalBusyLoader } from "@/server/externalCalendar/deps";

/** Production wiring for the guest booking service (service role + PostgreSQL rate limiter + external calendar busy time). */
export function getPublicBookingDeps(): PublicBookingDeps {
  return { admin: createSupabaseAdminClient(), rateLimiter: getRateLimiter(), externalBusy: getExternalBusyLoader() };
}

/** Production wiring for the client directory (service role; only the 0017 listing function). */
export function getDiscoveryDeps(): { admin: ReturnType<typeof createSupabaseAdminClient> } {
  return { admin: createSupabaseAdminClient() };
}
