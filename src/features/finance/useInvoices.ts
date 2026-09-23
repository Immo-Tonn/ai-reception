"use client";

import { useMemo } from "react";
import { useRepositoryCollection } from "@/lib/repository/useRepository";
import { getInvoicesRepository } from "./repository";

export function useInvoices(workspaceSlug: string) {
  const repository = useMemo(() => getInvoicesRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}
