import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Invoice } from "./types";
import { demoInvoices } from "./demoData";

const cache = new Map<string, Repository<Invoice>>();

export function getInvoicesRepository(workspaceSlug: string): Repository<Invoice> {
  const key = `serviceos:${workspaceSlug}:invoices`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<Invoice>(key, demoInvoices);
    cache.set(key, repository);
  }
  return repository;
}
