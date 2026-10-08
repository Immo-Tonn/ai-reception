import type { InvoiceStatus } from "./types";

/**
 * THE status mapping (single definition; migration 0022 documents the same table).
 *
 *   domain / UI   database invoice_status
 *   -----------   ----------------------
 *   draft         draft
 *   unpaid        sent            (issued, nothing paid; the legacy UI word)
 *   partial       partially_paid
 *   paid          paid
 *   cancelled     void            (final, locked)
 *   overdue       DERIVED: (sent | partially_paid) and due date < today (workspace-local). Never stored.
 *
 * Why derived: a stored "overdue" would need a cron and goes stale at midnight; deriving it at read time
 * is always right for the workspace's own calendar day.
 */
export type DbInvoiceStatus = "draft" | "sent" | "paid" | "partially_paid" | "overdue" | "void";

const FROM_DB: Record<DbInvoiceStatus, InvoiceStatus> = {
  draft: "draft",
  sent: "unpaid",
  partially_paid: "partial",
  paid: "paid",
  overdue: "overdue",
  void: "cancelled",
};

const TO_DB: Record<InvoiceStatus, DbInvoiceStatus> = {
  draft: "draft",
  unpaid: "sent",
  partial: "partially_paid",
  paid: "paid",
  overdue: "sent", // overdue is never written; it is "sent" with a past due date
  cancelled: "void",
};

export function statusFromDb(status: string): InvoiceStatus {
  return FROM_DB[status as DbInvoiceStatus] ?? "unpaid";
}

export function statusToDb(status: InvoiceStatus): DbInvoiceStatus {
  return TO_DB[status];
}

/** Read-time status: unpaid/partial + due date before `today` (YYYY-MM-DD, workspace-local) = overdue. */
export function effectiveStatus(status: InvoiceStatus, dueDate: string | null | undefined, today: string): InvoiceStatus {
  if ((status === "unpaid" || status === "partial") && dueDate && dueDate < today) return "overdue";
  return status;
}

/** Counts as money still owed (excludes draft and cancelled). */
export function isOpenInvoice(status: InvoiceStatus): boolean {
  return status === "unpaid" || status === "partial" || status === "overdue";
}
