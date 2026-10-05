import { RemoteRepositoryError, createRemoteRepository } from "@/lib/repository/createRemoteRepository";
import type { Repository } from "@/lib/repository/types";
import {
  createInvoiceAction,
  listInvoicesAction,
  getInvoiceAction,
  updateInvoiceAction,
  updateInvoiceStatusAction,
} from "@/server/actions/finance.actions";
import type { Invoice } from "./types";

/**
 * Invoices of a REAL workspace: Server Actions over the shared database. Used by the generic hooks of
 * Today / Analytics / Work. A caller without `finance.view` (e.g. staff) simply sees no invoices there;
 * every other failure is rethrown honestly. The Finance screen has its own hook (useFinance) with
 * error states.
 */
export function createRemoteInvoicesRepository(workspaceSlug: string): Repository<Invoice> {
  const inner = createRemoteRepository<Invoice>({
    list: () => listInvoicesAction(workspaceSlug),
    get: (id) => getInvoiceAction(workspaceSlug, id),
    create: (item) =>
      createInvoiceAction(workspaceSlug, {
        client: item.client,
        clientId: item.clientId ?? null,
        appointmentId: item.appointmentId ?? null,
        ...(item.items && item.items.length > 0
          ? { items: item.items.map((i) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice })) }
          : { amount: item.amount }),
        currency: item.currency,
        bucket: item.bucket,
        financialBucketId: item.financialBucketId ?? null,
        visibility: item.visibility,
        dueDate: item.dueDate ?? null,
        notes: item.notes ?? "",
        status: item.status === "draft" ? "draft" : "unpaid",
      }),
    update: (id, patch) => {
      const onlyStatus = Object.keys(patch).every((k) => k === "status");
      if (onlyStatus && (patch.status === "paid" || patch.status === "unpaid" || patch.status === "cancelled")) {
        return updateInvoiceStatusAction(workspaceSlug, { id, status: patch.status });
      }
      return updateInvoiceAction(workspaceSlug, {
        id,
        ...(patch.client !== undefined ? { client: patch.client } : {}),
        ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
        ...(patch.items !== undefined ? { items: patch.items } : {}),
        ...(patch.bucket !== undefined ? { bucket: patch.bucket } : {}),
        ...(patch.financialBucketId !== undefined ? { financialBucketId: patch.financialBucketId } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      });
    },
  });
  return {
    ...inner,
    async list() {
      try {
        return await inner.list();
      } catch (error) {
        if (error instanceof RemoteRepositoryError && error.code === "forbidden") return [];
        throw error;
      }
    },
  };
}
