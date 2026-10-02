import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Invoice } from "./types";
import { demoInvoices } from "./demoData";

// Demo data belongs to the four demo workspaces only. A real workspace starts EMPTY until this
// entity has its own shared backend — it must never show someone else's fake records.
const cache = new Map<string, Repository<Invoice>>();

export function getInvoicesRepository(workspaceSlug: string): Repository<Invoice> {
  const key = `serviceos:${workspaceSlug}:invoices`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<Invoice>(key, isDemoWorkspaceSlug(workspaceSlug) ? demoInvoices : []);
    cache.set(key, repository);
  }
  return repository;
}
