import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan, can } from "@/server/permissions/roles";
import { getServerInvoicesRepository, getServerAuditLogRepository } from "@/server/repository/registry";
import { RepositoryNotFoundError } from "@/server/repository/errors";
import {
  createInvoiceSchema,
  recordPaymentSchema,
  updateInvoiceSchema,
  updateInvoiceStatusSchema,
  type CreateInvoiceInput,
  type RecordPaymentInput,
  type UpdateInvoiceInput,
  type UpdateInvoiceStatusInput,
} from "@/server/validation/finance.schema";
import { calculateRevenue, calculateOutstanding } from "@/features/finance/calculations";
import { canSeeVisibility } from "./masking";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { isValidTimeZone, resolveToday } from "@/lib/time/zonedTime";
import { fromMinor, linesTotalMinor, toMinor } from "@/lib/money";
import type { Invoice, InvoiceItem } from "@/features/finance/types";
import type { FinancialBucket, Visibility } from "@/features/appointments/types";
import type { RevenueSummary } from "@/features/finance/calculations";
import type { AuditLogEntry } from "@/features/auditLog/types";

export interface FinanceSummary {
  revenue: RevenueSummary;
  outstanding: number;
  invoices: Invoice[];
  /** What this caller may do. The browser never has to guess (and never receives rows it may not see). */
  capabilities: { canEdit: boolean; canUsePrivateBucket: boolean };
}

/** Rows the caller may see: Visibility and bucket are two independent passes (real workspaces are ALSO filtered by RLS). */
function visibleTo(session: Session, all: Invoice[]): Invoice[] {
  const bucketVisible = can(session.role, "financial_bucket.private.view") ? all : all.filter((i) => i.bucket !== "private");
  return bucketVisible.filter((i) => canSeeVisibility(i.visibility, session));
}

function assertCanUseTargets(session: Session, bucket: FinancialBucket | undefined, visibility: Visibility | undefined) {
  if (bucket === "private") assertCan(session.role, "financial_bucket.private.view");
  if (visibility === "private" || visibility === "custom") assertCan(session.role, "private_records.view");
  if (visibility === "ownerOnly") assertCan(session.role, "owner_records.view");
}

/**
 * Bucket-scoped AND visibility-scoped read: an `accountant`/`manager`
 * without `financial_bucket.private.view` gets the Main-only numbers,
 * never a Private total folded silently into "combined" (§8
 * privacy+finance separation — this is the read-side half of it,
 * masking.ts is the appointment-side half). Visibility is filtered as a
 * fully separate pass so it never depends on which bucket the invoice
 * happens to be in. The filter runs HERE, on the server: a private row or
 * total is never serialised for a caller without the permission.
 */
export async function getFinanceSummary(session: Session): Promise<FinanceSummary> {
  assertCan(session.role, "finance.view");
  const visible = visibleTo(session, await getServerInvoicesRepository(session.workspaceId).list());
  return {
    revenue: calculateRevenue(visible),
    outstanding: calculateOutstanding(visible),
    invoices: visible,
    capabilities: {
      canEdit: can(session.role, "finance.edit"),
      canUsePrivateBucket: can(session.role, "financial_bucket.private.view"),
    },
  };
}

export async function listInvoices(session: Session): Promise<Invoice[]> {
  assertCan(session.role, "finance.view");
  return visibleTo(session, await getServerInvoicesRepository(session.workspaceId).list());
}

export async function getInvoice(session: Session, id: string): Promise<Invoice | undefined> {
  assertCan(session.role, "finance.view");
  const invoice = await getServerInvoicesRepository(session.workspaceId).get(id);
  return invoice && visibleTo(session, [invoice]).length > 0 ? invoice : undefined;
}

/**
 * IANA time zone of a real workspace (user-scoped read under RLS), or null for
 * demo workspaces / unreadable / invalid zones (callers then keep the legacy
 * browser-local behaviour via resolveToday(now, null)).
 */
export async function getWorkspaceTimeZone(session: Session): Promise<string | null> {
  if (isDemoWorkspaceSlug(session.workspaceId)) return null;
  const client = await createSupabaseServerClient();
  const { data } = await client.from("workspaces").select("timezone").eq("id", session.workspaceId).maybeSingle();
  const tz = (data?.timezone as string | undefined) ?? null;
  return tz && isValidTimeZone(tz) ? tz : null;
}

/** Default currency of a real workspace (ISO code), or null for demo / unreadable. */
export async function getWorkspaceCurrency(session: Session): Promise<string | null> {
  if (isDemoWorkspaceSlug(session.workspaceId)) return null;
  const client = await createSupabaseServerClient();
  const { data } = await client.from("workspaces").select("default_currency").eq("id", session.workspaceId).maybeSingle();
  const code = (data?.default_currency as string | undefined) ?? null;
  return code && /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Audit: one entry per meaningful change; the summary carries the invoice NUMBER only (no names, no amounts). */
async function audit(session: Session, action: AuditLogEntry["action"], invoice: Pick<Invoice, "id" | "number">, text: string) {
  try {
    await getServerAuditLogRepository(session.workspaceId).create({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      entityType: "invoice",
      entityId: invoice.id,
      summary: `${invoice.number}: ${text}`,
      source: "user",
    });
  } catch (error) {
    // The change itself is done; never make the caller retry (and duplicate) because the log failed.
    console.error("[finance] audit write failed:", error instanceof Error ? error.name : "unknown");
  }
}

function normaliseItems(items: { description: string; quantity: number; unitPrice: number }[] | undefined, amount: number | undefined): InvoiceItem[] {
  if (items && items.length > 0) return items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice }));
  // Legacy callers that only know a total: one line.
  if (amount && amount > 0) return [{ description: "Service", quantity: 1, unitPrice: amount }];
  return [];
}

export async function createInvoice(
  session: Session,
  input: CreateInvoiceInput,
  now: Date = new Date(),
): Promise<Invoice> {
  assertCan(session.role, "finance.edit");
  const data = createInvoiceSchema.parse(input);
  assertCanUseTargets(session, data.bucket, data.visibility);

  const items = normaliseItems(data.items, data.amount);
  const invoice: Invoice = {
    id: crypto.randomUUID(), // ignored by the database (it generates the id and the number)
    number: isDemoWorkspaceSlug(session.workspaceId) ? `#${Math.floor(1000 + Math.random() * 9000)}` : "",
    client: data.client,
    clientId: data.clientId ?? null,
    amount: fromMinor(linesTotalMinor(items)),
    paidAmount: 0,
    // real workspaces: empty = the workspace default currency (chosen by the database)
    currency: data.currency ?? (isDemoWorkspaceSlug(session.workspaceId) ? "EUR" : ""),
    status: data.status,
    bucket: data.bucket,
    financialBucketId: data.financialBucketId ?? null,
    visibility: data.visibility,
    // Business calendar day in the WORKSPACE time zone (never UTC).
    date: resolveToday(now, await getWorkspaceTimeZone(session)),
    dueDate: data.dueDate ?? null,
    notes: data.notes,
    items,
    appointmentId: data.appointmentId ?? null,
  };
  const created = await getServerInvoicesRepository(session.workspaceId).create(invoice);
  await audit(session, "created", created, "created");
  return created;
}

export async function updateInvoice(session: Session, input: UpdateInvoiceInput): Promise<Invoice> {
  assertCan(session.role, "finance.edit");
  const { id, ...patch } = updateInvoiceSchema.parse(input);
  assertCanUseTargets(session, patch.bucket, patch.visibility);
  const repo = getServerInvoicesRepository(session.workspaceId);
  const existing = await repo.get(id);
  if (!existing || visibleTo(session, [existing]).length === 0) throw new RepositoryNotFoundError("invoices.update");

  const next: Partial<Invoice> = {
    ...(patch.client !== undefined ? { client: patch.client } : {}),
    ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
    ...(patch.bucket !== undefined ? { bucket: patch.bucket } : {}),
    ...(patch.financialBucketId !== undefined ? { financialBucketId: patch.financialBucketId } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
  };
  if (patch.items !== undefined) {
    next.items = patch.items;
    next.amount = fromMinor(linesTotalMinor(patch.items));
  }
  const updated = await repo.update(id, next);
  if (!updated) throw new RepositoryNotFoundError("invoices.update");
  await audit(session, "updated", updated, "edited");
  return updated;
}

/** paid = record a payment for the whole balance; unpaid = void payments (draft: issue it); cancelled = cancel. */
export async function updateInvoiceStatus(session: Session, input: UpdateInvoiceStatusInput): Promise<Invoice | undefined> {
  assertCan(session.role, "finance.edit");
  const { id, status } = updateInvoiceStatusSchema.parse(input);
  const repo = getServerInvoicesRepository(session.workspaceId);
  const existing = await repo.get(id);
  if (!existing || visibleTo(session, [existing]).length === 0) return undefined;

  let updated: Invoice | undefined;
  if (status === "paid") {
    const balanceMinor = toMinor(existing.amount) - toMinor(existing.paidAmount ?? 0);
    if (balanceMinor <= 0 && existing.status === "paid") return existing;
    updated = await repo.recordPayment(id, { amount: fromMinor(balanceMinor), method: "cash" });
  } else if (status === "unpaid") {
    updated = existing.status === "draft" ? await repo.update(id, { status: "unpaid" }) : await repo.voidPayments(id);
  } else {
    updated = await repo.cancel(id);
  }
  if (updated) {
    await audit(session, status === "cancelled" ? "cancelled" : "statusChanged", updated, `${existing.status} → ${updated.status}`);
  }
  return updated;
}

/** One payment (full or partial). Overpayment and payments on cancelled invoices are refused by the database. */
export async function recordPayment(session: Session, input: RecordPaymentInput): Promise<Invoice> {
  assertCan(session.role, "finance.edit");
  const data = recordPaymentSchema.parse(input);
  const repo = getServerInvoicesRepository(session.workspaceId);
  const existing = await repo.get(data.id);
  if (!existing || visibleTo(session, [existing]).length === 0) throw new RepositoryNotFoundError("invoices.payment");
  const updated = await repo.recordPayment(data.id, { amount: data.amount, method: data.method, paidAt: data.paidAt });
  if (!updated) throw new RepositoryNotFoundError("invoices.payment");
  await audit(session, updated.status !== existing.status ? "statusChanged" : "updated", updated, `payment recorded (${existing.status} → ${updated.status})`);
  return updated;
}
