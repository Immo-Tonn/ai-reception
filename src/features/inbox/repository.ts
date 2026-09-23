import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Conversation } from "./types";
import { demoConversations } from "./demoData";

const cache = new Map<string, Repository<Conversation>>();

export function getInboxRepository(workspaceSlug: string): Repository<Conversation> {
  const key = `serviceos:${workspaceSlug}:inbox`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<Conversation>(key, demoConversations);
    cache.set(key, repository);
  }
  return repository;
}
