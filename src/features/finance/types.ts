import type { FinancialBucket, Visibility } from "@/features/appointments/types";
import type { Repository } from "@/lib/repository/types";

/**
 * Domain status of an invoice (UI + services). Mapping to the database enum `invoice_status` lives in
 * ONE place: ./status.ts (documented there and in migration 0022).
 *   draft | unpaid (= DB "sent") | partial (= "partially_paid") | paid | overdue (DERIVED) | cancelled (= "void")
 * `unpaid`, `paid` and `partial` are the original UI values and keep working unchanged.
 */
export type InvoiceStatus = "draft" | "unpaid" | "partial" | "paid" | "overdue" | "cancelled";

export interface InvoiceItem {
  id?: string;
  description: string;
  /** Up to 3 decimals. Money is computed in integer minor units (src/lib/money.ts), never with float sums. */
  quantity: number;
  /** Major units, 2 decimals. */
  unitPrice: number;
}

export type PaymentMethod = "cash" | "bank_transfer" | "card" | "online" | "custom";

export interface InvoicePayment {
  id: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string; // ISO instant
  voided: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  /** Display name snapshot. Use `clientId` for linking. */
  client: string;
  /** The real client record (real workspaces). */
  clientId?: string | null;
  /** Total in major units. For real workspaces always = sum of the rounded line totals. */
  amount: number;
  /** Sum of non-voided payments (real workspaces / demo "paid"). */
  paidAmount?: number;
  currency: string;
  /** Effective status (overdue already derived from `dueDate`). */
  status: InvoiceStatus;
  /** Main / Private / Custom class of the bucket. */
  bucket: FinancialBucket;
  /** Concrete bucket (custom buckets keep their id on edit). */
  financialBucketId?: string | null;
  /** Independent of `bucket`, same as Appointment/Work — an invoice can
   * be Visibility=PRIVATE with FinancialBucket=MAIN or any other
   * combination (§7.1, §97 non-negotiable requirement #6). */
  visibility: Visibility;
  date: string; // ISO date (issue day, workspace-local)
  dueDate?: string | null;
  notes?: string;
  items?: InvoiceItem[];
  payments?: InvoicePayment[];
  appointmentId?: string | null;
  jobId?: string | null;
  projectId?: string | null;
  quoteId?: string | null;
}

/** Repository<Invoice> plus the payment / cancel operations of an invoice (real: Supabase, demo: in-memory / localStorage). */
export interface InvoicesRepository extends Repository<Invoice> {
  /** Records a payment (major units). Status follows the payments (partial / paid). */
  recordPayment(id: string, payment: { amount: number; method: PaymentMethod; paidAt?: string }): Promise<Invoice | undefined>;
  /** "Mark as unpaid": voids every active payment (history stays). */
  voidPayments(id: string): Promise<Invoice | undefined>;
  /** Cancels the invoice (final). Refused while it has payments. */
  cancel(id: string): Promise<Invoice | undefined>;
}
