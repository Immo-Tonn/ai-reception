import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { WaitingListEntry } from "./types";
import { demoWaitingList } from "./demoData";
import { createRemoteWaitingListRepository } from "./remoteRepository";

// Demo workspaces keep the browser-local fixtures. A real workspace uses the shared database
// (Server Actions -> service -> Supabase under RLS) and never falls back to local data.
const cache = new Map<string, Repository<WaitingListEntry>>();

export function getWaitingListRepository(workspaceSlug: string): Repository<WaitingListEntry> {
  const demo = isDemoWorkspaceSlug(workspaceSlug);
  const key = demo ? `serviceos:${workspaceSlug}:waitingList` : `remote:${workspaceSlug}:waitingList`;
  let repository = cache.get(key);
  if (!repository) {
    repository = demo
      ? createLocalRepository<WaitingListEntry>(key, demoWaitingList)
      : createRemoteWaitingListRepository(workspaceSlug);
    cache.set(key, repository);
  }
  return repository;
}
