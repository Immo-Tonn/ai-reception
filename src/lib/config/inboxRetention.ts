/**
 * How long Inbox NOTIFICATIONS (`inbox_events`) are meant to be kept.
 * Server variable `INBOX_RETENTION_MONTHS` (whole months, 1..120, default 12).
 *
 * Only notifications: appointments (the client's booking history), audit_logs,
 * invoices and payments are separate tables with their own (legal) periods and
 * are never touched by this setting.
 *
 * Automatic deletion is NOT implemented / switched on: it needs a separate
 * approval (and legal review of the period). Until then nothing is deleted and
 * this value is only the agreed target, documented in
 * docs/BOOKING_STATUSES_AND_INBOX.md §4.
 */
export const INBOX_RETENTION_DEFAULT_MONTHS = 12;
export const INBOX_AUTO_DELETE_ENABLED = false as const;

export function resolveInboxRetentionMonths(raw: string | undefined | null): number {
  const value = Number((raw ?? "").trim());
  return Number.isInteger(value) && value >= 1 && value <= 120 ? value : INBOX_RETENTION_DEFAULT_MONTHS;
}

export function getInboxRetentionMonths(): number {
  return resolveInboxRetentionMonths(process.env.INBOX_RETENTION_MONTHS);
}

/** Events created before this instant are past the retention period (for a future, approved cleanup). */
export function inboxRetentionCutoff(months: number, now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}
