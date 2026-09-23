import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan, can } from "@/server/permissions/roles";
import { getServerInvoicesRepository, getServerAuditLogRepository } from "@/server/repository/registry";
import {
  createInvoiceSchema,
  updateInvoiceStatusSchema,
  type CreateInvoiceInput,
  type UpdateInvoiceStatusInput,
} from "@/server/validation/finance.schema";
import { calculateRevenue, calculateOutstanding } from "@/features/finance/calculations";
import { canSeeVisibility } from "./masking";
import type { Invoice } from "@/features/finance/types";
import type { RevenueSummary } from "@/features/finance/calculations";

/**
 * Bucket-scoped AND visibility-scoped read: an `accountant`/`manager`
 * without `financial_bucket.private.view` gets the Main-only numbers,
 * never a Private total folded silently into "combined" (§8
 * privacy+finance separation — this is the read-side half of it,
 * masking.ts is the appointment-side half). Visibility is filtered as a
 * fully separate pass so it never depends on which bucket the invoice
 * happens to be in.
 */
export async function getFinanceSummary(
  session: Session,
): Promise<{ revenue: RevenueSummary; outstanding: number; invoices: Invoice[] }> {
  assertCan(session.role, "finance.view");
  const all = await getServerInvoicesRepository(session.workspaceId).list();

  const bucketVisible = can(session.role, "financial_bucket.private.view")
    ? all
    : all.filter((i) => i.bucket !== "private");
  const visible = bucketVisible.filter((i) => canSeeVisibility(i.visibility, session));

  return {
    revenue: calculateRevenue(visible),
    outstanding: calculateOutstanding(visible),
    invoices: visible,
  };
}

export async function createInvoice(session: Session, input: CreateInvoiceInput): Promise<Invoice> {
  assertCan(session.role, "finance.edit");
  const data = createInvoiceSchema.parse(input);
  if (data.bucket === "private") assertCan(session.role, "financial_bucket.private.view");

  const invoice: Invoice = {
    ...data,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    number: `#${Math.floor(1000 + Math.random() * 9000)}`,
    status: "unpaid",
    date: new Date().toISOString().slice(0, 10),
  };
  await getServerInvoicesRepository(session.workspaceId).create(invoice);
  await getServerAuditLogRepository(session.workspaceId).create({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    action: "created",
    entityType: "invoice",
    entityId: invoice.id,
    summary: `${invoice.client} · ${invoice.amount} ${invoice.currency}`,
    source: "user",
  });
  return invoice;
}

export async function updateInvoiceStatus(
  session: Session,
  input: UpdateInvoiceStatusInput,
): Promise<Invoice | undefined> {
  assertCan(session.role, "finance.edit");
  const { id, status } = updateInvoiceStatusSchema.parse(input);
  const updated = await getServerInvoicesRepository(session.workspaceId).update(id, { status });
  if (updated) {
    await getServerAuditLogRepository(session.workspaceId).create({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      action: "updated",
      entityType: "invoice",
      entityId: id,
      summary: `${updated.client}: status → ${status}`,
      source: "user",
    });
  }
  return updated;
}
