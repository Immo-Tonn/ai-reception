"use client";

import { useMemo } from "react";
import { useRepositoryCollection } from "@/lib/repository/useRepository";
import { getClientsRepository } from "./repository";

export function useClients(workspaceSlug: string) {
  const repository = useMemo(() => getClientsRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}
