import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { ClientRecord } from "./types";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createRemoteClientsRepository } from "./remoteRepository";

const cache = new Map<string, Repository<ClientRecord>>();

export function getClientsRepository(workspaceSlug: string): Repository<ClientRecord> {
  // Real workspace: the shared database (via Server Actions). Demo: browser localStorage.
  if (!isDemoWorkspaceSlug(workspaceSlug)) {
    const remoteKey = `remote:${workspaceSlug}`;
    let remote = cache.get(remoteKey);
    if (!remote) {
      remote = createRemoteClientsRepository(workspaceSlug);
      cache.set(remoteKey, remote);
    }
    return remote;
  }

  const key = `serviceos:${workspaceSlug}:clients`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<ClientRecord>(key, getWorkspaceConfig(workspaceSlug).clients);
    cache.set(key, repository);
  }
  return repository;
}
