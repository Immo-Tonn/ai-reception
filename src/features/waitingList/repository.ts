import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { WaitingListEntry } from "./types";
import { demoWaitingList } from "./demoData";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";

const cache = new Map<string, Repository<WaitingListEntry>>();

export function getWaitingListRepository(workspaceSlug: string): Repository<WaitingListEntry> {
  const key = `serviceos:${workspaceSlug}:waitingList`;
  let repository = cache.get(key);
  if (!repository) {
    const seed = isDemoWorkspaceSlug(workspaceSlug) ? demoWaitingList : [];
    repository = createLocalRepository<WaitingListEntry>(key, seed);
    cache.set(key, repository);
  }
  return repository;
}
