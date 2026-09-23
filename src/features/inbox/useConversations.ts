"use client";

import { useMemo } from "react";
import { useRepositoryCollection } from "@/lib/repository/useRepository";
import { getInboxRepository } from "./repository";

export function useConversations(workspaceSlug: string) {
  const repository = useMemo(() => getInboxRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}
