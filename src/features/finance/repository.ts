import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Invoice } from "./types";
import { demoInvoices } from "./demoData";
import { createRemoteInvoicesRepository } from "./remoteRepository";

const cache = new Map<string, Repository<Invoice>>();

/**
 * Real workspace: the shared database (via Server Actions) — never demo data, never localStorage.
 * Demo workspaces (the four presets): browser localStorage seeded with the demo invoices.
 */
export function getInvoicesRepository(workspaceSlug: string): Repository<Invoice> {
  if (!isDemoWorkspaceSlug(workspaceSlug)) {
    const remoteKey = `remote:${workspaceSlug}`;
    let remote = cache.get(remoteKey);
    if (!remote) {
      remote = createRemoteInvoicesRepository(workspaceSlug);
      cache.set(remoteKey, remote);
    }
    return remote;
  }
  const key = `serviceos:${workspaceSlug}:invoices`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<Invoice>(key, demoInvoices);
    cache.set(key, repository);
  }
  return repository;
}
