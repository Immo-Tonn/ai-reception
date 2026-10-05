import type { FinancialBucket } from "@/features/appointments/types";
import type { Invoice, InvoiceItem, InvoicePayment, PaymentMethod } from "@/features/finance/types";
import { effectiveStatus, statusFromDb } from "@/features/finance/status";
import { fromMinor, toMinor } from "@/lib/money";
import { visibilityFromDb } from "./appointmentsMapper";

export interface InvoiceRow {
  id: string;
  workspace_id: string;
  number: string;
  client_id: string | null;
  client_name: string;
  appointment_id: string | null;
  financial_bucket_id: string | null;
  visibility: string;
  status: string;
  currency: string;
  amount: string | number;
  issued_at: string;
  due_at: string | null;
  notes: string;
  job_id?: string | null;
  project_id?: string | null;
  quote_id?: string | null;
}

export interface InvoiceItemRow {
  id: string;
  invoice_id: string;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  position: number;
}

export interface PaymentRow {
  id: string;
  invoice_id: string;
  amount: string | number;
  method: string;
  paid_at: string;
  voided_at: string | null;
}

export interface InvoiceLookups {
  /** bucket id -> kind, for buckets the viewer may use (private ones only with the private permission). */
  bucketKinds: Map<string, FinancialBucket>;
  itemsByInvoice: Map<string, InvoiceItemRow[]>;
  paymentsByInvoice: Map<string, PaymentRow[]>;
  /** Workspace-local calendar day, for the derived overdue status. */
  today: string;
}

const money = (v: string | number) => fromMinor(toMinor(v));

export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

export function itemFromRow(row: InvoiceItemRow): InvoiceItem {
  return { id: row.id, description: row.description, quantity: Number(row.quantity), unitPrice: money(row.unit_price) };
}

export function paymentFromRow(row: PaymentRow): InvoicePayment {
  return {
    id: row.id,
    amount: money(row.amount),
    method: row.method as PaymentMethod,
    paidAt: new Date(row.paid_at).toISOString(),
    voided: row.voided_at != null,
  };
}

export function invoiceFromRow(row: InvoiceRow, lookups: InvoiceLookups): Invoice {
  const payments = (lookups.paymentsByInvoice.get(row.id) ?? []).map(paymentFromRow);
  const paidMinor = payments.filter((p) => !p.voided).reduce((sum, p) => sum + toMinor(p.amount), 0);
  const kind = row.financial_bucket_id ? (lookups.bucketKinds.get(row.financial_bucket_id) ?? "custom") : "main";
  const stored = statusFromDb(row.status);
  return {
    id: row.id,
    number: row.number,
    client: row.client_name,
    clientId: row.client_id,
    amount: money(row.amount),
    paidAmount: fromMinor(paidMinor),
    currency: row.currency,
    status: effectiveStatus(stored, row.due_at, lookups.today),
    bucket: kind,
    financialBucketId: row.financial_bucket_id,
    visibility: visibilityFromDb(row.visibility),
    date: String(row.issued_at).slice(0, 10),
    dueDate: row.due_at ? String(row.due_at).slice(0, 10) : null,
    notes: row.notes ?? "",
    items: (lookups.itemsByInvoice.get(row.id) ?? []).map(itemFromRow),
    payments,
    appointmentId: row.appointment_id,
    jobId: row.job_id ?? null,
    projectId: row.project_id ?? null,
    quoteId: row.quote_id ?? null,
  };
}
