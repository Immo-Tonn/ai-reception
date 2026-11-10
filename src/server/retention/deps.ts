import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseRetentionStore, type RetentionStore } from "./retention";

/**
 * Production wiring for the retention cron (service role: booking_claims have no
 * business-user policies and retention_dry_run is granted to service_role only).
 * Called only by the CRON_SECRET-protected cron route.
 */
export function getRetentionStore(): RetentionStore {
  return createSupabaseRetentionStore(createSupabaseAdminClient());
}
