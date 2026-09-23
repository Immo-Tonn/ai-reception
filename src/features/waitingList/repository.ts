import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { WaitingListEntry } from "./types";
import { demoWaitingList } from "./demoData";

const cache = new Map<string, Repository<WaitingListEntry>>();

export function getWaitingListRepository(workspaceSlug: string): Repository<WaitingListEntry> {
  const key = `serviceos:${workspaceSlug}:waitingList`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<WaitingListEntry>(key, demoWaitingList);
    cache.set(key, repository);
  }
  return repository;
}
