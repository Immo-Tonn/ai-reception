import type { Repository } from "@/lib/repository/types";
import { fromMinor, toMinor } from "@/lib/money";
import type { Invoice, InvoicesRepository } from "./types";

const paidOf = (i: Invoice) => toMinor(i.paidAmount ?? (i.status === "paid" ? i.amount : 0));

/**
 * Demo workspaces (in-memory on the server, localStorage in the browser): the same payment / cancel
 * operations as the real backend, without a database. `conflict` builds the error the caller's layer
 * understands (server: RepositoryConflictError, browser: RemoteRepositoryError("conflict")).
 */
export function withDemoInvoiceOps(repo: Repository<Invoice>, conflict: () => Error): InvoicesRepository {
  return {
    list: () => repo.list(),
    get: (id) => repo.get(id),
    create: (item) => repo.create(item),
    update: (id, patch) => repo.update(id, patch),
    remove: (id) => repo.remove(id),
    replaceAll: (items) => repo.replaceAll(items),
    async recordPayment(id, payment) {
      const invoice = await repo.get(id);
      if (!invoice) return undefined;
      if (invoice.status === "cancelled") throw conflict();
      const paid = paidOf(invoice) + toMinor(payment.amount);
      const total = toMinor(invoice.amount);
      if (paid > total) throw conflict();
      return repo.update(id, { paidAmount: fromMinor(paid), status: paid >= total ? "paid" : "partial" });
    },
    async voidPayments(id) {
      const invoice = await repo.get(id);
      if (!invoice) return undefined;
      if (invoice.status === "cancelled") throw conflict();
      return repo.update(id, { paidAmount: 0, status: "unpaid" });
    },
    async cancel(id) {
      const invoice = await repo.get(id);
      if (!invoice) return undefined;
      if (paidOf(invoice) > 0) throw conflict();
      return repo.update(id, { status: "cancelled" });
    },
  };
}
