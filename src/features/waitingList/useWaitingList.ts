"use client";

import { useMemo } from "react";
import { useRepositoryCollection } from "@/lib/repository/useRepository";
import { getWaitingListRepository } from "./repository";

export function useWaitingList(workspaceSlug: string) {
  const repository = useMemo(() => getWaitingListRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}
