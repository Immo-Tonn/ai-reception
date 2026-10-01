import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Invoice } from "./types";
import { demoInvoices } from "./demoData";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";

const cache = new Map<string, Repository<Invoice>>();

export function getInvoicesRepository(workspaceSlug: string): Repository<Invoice> {
  const key = `serviceos:${workspaceSlug}:invoices`;
  let repository = cache.get(key);
  if (!repository) {
    // Only the four demo presets seed with the shared demo invoices — a
    // real workspace starts with zero, never someone else's fake balance.
    const seed = isDemoWorkspaceSlug(workspaceSlug) ? demoInvoices : [];
    repository = createLocalRepository<Invoice>(key, seed);
    cache.set(key, repository);
  }
  return repository;
}
