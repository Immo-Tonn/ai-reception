import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { ClientRecord } from "./types";
import { getWorkspaceConfig } from "@/features/workspace/registry";

const cache = new Map<string, Repository<ClientRecord>>();

export function getClientsRepository(workspaceSlug: string): Repository<ClientRecord> {
  const key = `serviceos:${workspaceSlug}:clients`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<ClientRecord>(key, getWorkspaceConfig(workspaceSlug).clients);
    cache.set(key, repository);
  }
  return repository;
}
