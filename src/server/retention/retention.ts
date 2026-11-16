import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * GDPR retention checks run by the daily cron (docs/GDPR_IMPLEMENTATION_PLAN.md,
 * stage 3). ONE step changes data: expired, never-claimed booking claims are
 * deleted (the token can no longer be used: claim_booking refuses expired
 * tokens). Never touched: claimed claims (a client account's "My bookings"),
 * claims that are still valid, and claims of an appointment that is still open
 * (pending / confirmed / checked in / in progress). Everything else is a dry
 * run: COUNTS only.
 *
 * Periods are PROVISIONAL (Needs legal review). Automatic anonymisation and
 * notification deletion are NOT implemented: the flags are read and reported,
 * but nothing acts on them in this stage, whatever their value.
 */
export const RETENTION_POLICY = {
  /** Client data: months after the last completed visit (provisional). */
  clientMonths: 36,
  /** Inbox notifications: months (provisional). */
  inboxMonths: 12,
  /** Unclaimed booking claims are removed this many days after they expired (provisional, needs approval). */
  unclaimedClaimGraceDays: 30,
  /** At most this many claims per run (one run per day, short run time). */
  claimBatch: 500,
} as const;

export interface RetentionDryRun {
  clients: Record<string, unknown>;
  inboxEvents: Record<string, number>;
}

/** Appointment statuses of a process that is not finished yet. */
export const OPEN_APPOINTMENT_STATUSES = ["pending", "confirmed", "checked_in", "in_progress"] as const;

export interface RetentionStore {
  /**
   * Deletes up to `limit` claims with claimed_by IS NULL and expires_at < `expiredBefore`
   * whose appointment is not open (OPEN_APPOINTMENT_STATUSES); returns how many.
   */
  deleteExpiredUnclaimedBookingClaims(expiredBefore: Date, limit: number): Promise<number>;
  dryRun(clientCutoff: Date, inboxCutoff: Date): Promise<RetentionDryRun>;
}

export interface RetentionReport {
  bookingClaimsDeleted: number;
  /** true when the batch limit was reached — the next run continues. */
  bookingClaimsBatchFull: boolean;
  dryRun: RetentionDryRun | null;
  autoAnonymize: { requested: boolean; active: false };
  notificationDeletion: { requested: boolean; active: false };
  failedSteps: string[];
}

/** Only the exact string "true" counts; a missing, empty or misspelled value is off. */
export function isFlagOn(value: string | undefined): boolean {
  return value === "true";
}

export function monthsBefore(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

export async function runRetentionChecks(deps: {
  store: RetentionStore;
  now?: () => Date;
  env?: Record<string, string | undefined>;
}): Promise<RetentionReport> {
  const now = deps.now ? deps.now() : new Date();
  const env = deps.env ?? process.env;
  const report: RetentionReport = {
    bookingClaimsDeleted: 0,
    bookingClaimsBatchFull: false,
    dryRun: null,
    autoAnonymize: { requested: isFlagOn(env.AUTO_ANONYMIZE_ENABLED), active: false },
    notificationDeletion: { requested: isFlagOn(env.INBOX_RETENTION_DELETE_ENABLED), active: false },
    failedSteps: [],
  };
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      report.failedSteps.push(name);
    }
  };
  await step("expired_booking_claims", async () => {
    const expiredBefore = new Date(now.getTime() - RETENTION_POLICY.unclaimedClaimGraceDays * 86_400_000);
    report.bookingClaimsDeleted = await deps.store.deleteExpiredUnclaimedBookingClaims(expiredBefore, RETENTION_POLICY.claimBatch);
    report.bookingClaimsBatchFull = report.bookingClaimsDeleted >= RETENTION_POLICY.claimBatch;
  });
  await step("retention_dry_run", async () => {
    report.dryRun = await deps.store.dryRun(monthsBefore(now, RETENTION_POLICY.clientMonths), monthsBefore(now, RETENTION_POLICY.inboxMonths));
  });
  return report;
}

export class RetentionStoreError extends Error {
  constructor() {
    super("Retention storage failed.");
    this.name = "RetentionStoreError";
  }
}

/** Service-role store (cron only). Errors carry no database text. */
export function createSupabaseRetentionStore(admin: SupabaseClient): RetentionStore {
  return {
    async deleteExpiredUnclaimedBookingClaims(expiredBefore, limit) {
      const before = expiredBefore.toISOString();
      const { data: batch, error } = await admin
        .from("booking_claims")
        .select("appointment_id")
        .is("claimed_by", null)
        .lt("expires_at", before)
        .order("expires_at", { ascending: true })
        .limit(limit);
      if (error) throw new RetentionStoreError();
      const candidates = (batch ?? []).map((r) => (r as { appointment_id: string }).appointment_id);
      if (candidates.length === 0) return 0;
      // Keep the claim while its appointment is still an open process.
      const { data: open, error: openError } = await admin
        .from("appointments")
        .select("id")
        .in("id", candidates)
        .in("status", [...OPEN_APPOINTMENT_STATUSES]);
      if (openError) throw new RetentionStoreError();
      const keep = new Set((open ?? []).map((r) => (r as { id: string }).id));
      const ids = candidates.filter((id) => !keep.has(id));
      if (ids.length === 0) return 0;
      // The conditions are repeated: a claim taken or renewed in between is not deleted.
      const { data: deleted, error: deleteError } = await admin
        .from("booking_claims")
        .delete()
        .in("appointment_id", ids)
        .is("claimed_by", null)
        .lt("expires_at", before)
        .select("appointment_id");
      if (deleteError) throw new RetentionStoreError();
      return (deleted ?? []).length;
    },
    async dryRun(clientCutoff, inboxCutoff) {
      const { data, error } = await admin.rpc("retention_dry_run", {
        p_client_cutoff: clientCutoff.toISOString(),
        p_inbox_cutoff: inboxCutoff.toISOString(),
      });
      if (error || !data) throw new RetentionStoreError();
      return data as RetentionDryRun;
    },
  };
}
