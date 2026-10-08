import { RemoteRepositoryError, type RemoteResult } from "@/lib/repository/createRemoteRepository";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { fromMinor, linesTotalMinor } from "@/lib/money";
import {
  createInvoiceAction,
  getFinanceSummaryAction,
  recordPaymentAction,
  updateInvoiceAction,
  updateInvoiceStatusAction,
} from "@/server/actions/finance.actions";
import { withDemoInvoiceOps } from "./demoOps";
import { getInvoicesRepository } from "./repository";
import type { FinancialBucket, Visibility } from "@/features/appointments/types";
import type { Invoice, InvoiceItem, PaymentMethod } from "./types";

export interface FinanceCapabilities {
  canEdit: boolean;
  canUsePrivateBucket: boolean;
}

/** What the new-invoice sheet hands over (real or demo). */
export interface InvoiceDraft {
  client: string;
  clientId: string | null;
  items: InvoiceItem[];
  bucket: FinancialBucket;
  financialBucketId: string | null;
  visibility: Visibility;
  dueDate: string | null;
  notes: string;
  currency: string;
  status: "draft" | "unpaid";
  /** workspace-local issue day */
  date: string;
}

export type InvoiceEdit = Partial<Pick<InvoiceDraft, "client" | "clientId" | "items" | "bucket" | "financialBucketId" | "visibility" | "dueDate" | "notes">>;

export interface FinanceBackend {
  load(): Promise<{ invoices: Invoice[]; capabilities: FinanceCapabilities }>;
  create(draft: InvoiceDraft): Promise<Invoice>;
  update(id: string, patch: InvoiceEdit): Promise<Invoice | undefined>;
  recordPayment(id: string, payment: { amount: number; method: PaymentMethod }): Promise<Invoice | undefined>;
  /** Draft -> issued (database `sent`). */
  issue(id: string): Promise<Invoice | undefined>;
  markUnpaid(id: string): Promise<Invoice | undefined>;
  cancel(id: string): Promise<Invoice | undefined>;
}

function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new RemoteRepositoryError(result.code);
  return result.data;
}

/** Real workspace: Server Actions only. Failures are thrown with their stable code, never swallowed. */
function realBackend(slug: string): FinanceBackend {
  return {
    async load() {
      const summary = unwrap(await getFinanceSummaryAction(slug));
      return { invoices: summary.invoices, capabilities: summary.capabilities };
    },
    async create(d) {
      return unwrap(
        await createInvoiceAction(slug, {
          client: d.client,
          clientId: d.clientId,
          items: d.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })),
          currency: d.currency,
          bucket: d.bucket,
          financialBucketId: d.financialBucketId,
          visibility: d.visibility,
          dueDate: d.dueDate,
          notes: d.notes,
          status: d.status,
        }),
      );
    },
    async update(id, patch) {
      return unwrap(await updateInvoiceAction(slug, { id, ...patch }));
    },
    async recordPayment(id, payment) {
      return unwrap(await recordPaymentAction(slug, { id, amount: payment.amount, method: payment.method }));
    },
    async issue(id) {
      return unwrap(await updateInvoiceStatusAction(slug, { id, status: "unpaid" }));
    },
    async markUnpaid(id) {
      return unwrap(await updateInvoiceStatusAction(slug, { id, status: "unpaid" }));
    },
    async cancel(id) {
      return unwrap(await updateInvoiceStatusAction(slug, { id, status: "cancelled" }));
    },
  };
}

/** Demo workspace: the browser's local demo repository. Never reaches the server or the database. */
function demoBackend(slug: string): FinanceBackend {
  const ops = withDemoInvoiceOps(getInvoicesRepository(slug), () => new RemoteRepositoryError("conflict"));
  return {
    async load() {
      return { invoices: await ops.list(), capabilities: { canEdit: true, canUsePrivateBucket: true } };
    },
    async create(d) {
      const invoice: Invoice = {
        id: String(Date.now()),
        number: `#${Math.floor(1000 + Math.random() * 9000)}`,
        client: d.client,
        clientId: d.clientId,
        amount: fromMinor(linesTotalMinor(d.items)),
        paidAmount: 0,
        currency: d.currency,
        status: d.status,
        bucket: d.bucket,
        financialBucketId: d.financialBucketId,
        visibility: d.visibility,
        date: d.date,
        dueDate: d.dueDate,
        notes: d.notes,
        items: d.items,
      };
      return ops.create(invoice);
    },
    async update(id, patch) {
      const next: Partial<Invoice> = { ...patch };
      if (patch.items) next.amount = fromMinor(linesTotalMinor(patch.items));
      return ops.update(id, next);
    },
    recordPayment: (id, payment) => ops.recordPayment(id, payment),
    issue: (id) => ops.update(id, { status: "unpaid" }),
    markUnpaid: (id) => ops.voidPayments(id),
    cancel: (id) => ops.cancel(id),
  };
}

export function getFinanceBackend(workspaceSlug: string): FinanceBackend {
  return isDemoWorkspaceSlug(workspaceSlug) ? demoBackend(workspaceSlug) : realBackend(workspaceSlug);
}
