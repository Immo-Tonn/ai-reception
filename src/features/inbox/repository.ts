import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Conversation } from "./types";
import { demoConversations } from "./demoData";

// Demo data belongs to the four demo workspaces only. A real workspace starts EMPTY until this
// entity has its own shared backend — it must never show someone else's fake records.
const cache = new Map<string, Repository<Conversation>>();

export function getInboxRepository(workspaceSlug: string): Repository<Conversation> {
  const key = `serviceos:${workspaceSlug}:inbox`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<Conversation>(key, isDemoWorkspaceSlug(workspaceSlug) ? demoConversations : []);
    cache.set(key, repository);
  }
  return repository;
}
