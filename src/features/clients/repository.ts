import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import { createRemoteRepository } from "@/lib/repository/createRemoteRepository";
import type { Repository } from "@/lib/repository/types";
import type { ClientRecord } from "./types";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import {
  createClientAction,
  listClientsAction,
  updateClientAction,
} from "@/server/actions/clients.actions";

const cache = new Map<string, Repository<ClientRecord>>();

function createRemoteClientsRepository(workspaceSlug: string): Repository<ClientRecord> {
  return createRemoteRepository<ClientRecord>({
    list: () => listClientsAction(workspaceSlug),
    create: (item) =>
      createClientAction(workspaceSlug, {
        name: item.name,
        email: item.email,
        phone: item.phone,
        tags: item.tags,
        notes: item.notes,
      }),
    update: (id, patch) =>
      updateClientAction(workspaceSlug, id, {
        name: patch.name,
        email: patch.email,
        phone: patch.phone,
        tags: patch.tags,
        notes: patch.notes,
      }),
  });
}

export function getClientsRepository(workspaceSlug: string): Repository<ClientRecord> {
  const key = `serviceos:${workspaceSlug}:clients`;
  let repository = cache.get(key);
  if (!repository) {
    repository = isDemoWorkspaceSlug(workspaceSlug)
      ? createLocalRepository<ClientRecord>(key, getWorkspaceConfig(workspaceSlug).clients)
      : createRemoteClientsRepository(workspaceSlug);
    cache.set(key, repository);
  }
  return repository;
}
