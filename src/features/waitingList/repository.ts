import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { WaitingListEntry } from "./types";
import { demoWaitingList } from "./demoData";

// Demo data belongs to the four demo workspaces only. A real workspace starts EMPTY until this
// entity has its own shared backend — it must never show someone else's fake records.
const cache = new Map<string, Repository<WaitingListEntry>>();

export function getWaitingListRepository(workspaceSlug: string): Repository<WaitingListEntry> {
  const key = `serviceos:${workspaceSlug}:waitingList`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<WaitingListEntry>(key, isDemoWorkspaceSlug(workspaceSlug) ? demoWaitingList : []);
    cache.set(key, repository);
  }
  return repository;
}
