"use client";

import { useMemo } from "react";
import { useRepositoryCollection } from "@/lib/repository/useRepository";
import type { Repository } from "@/lib/repository/types";
import type { Invoice } from "./types";
import { getInvoicesRepository } from "./repository";

/** Finance switched off (feature flag): no request at all, an always-empty collection. */
const DISABLED: Repository<Invoice> = {
  list: async () => [],
  get: async () => undefined,
  create: async (item) => item,
  update: async () => undefined,
  remove: async () => {},
  replaceAll: async () => {},
};

export function useInvoices(workspaceSlug: string, enabled = true) {
  const repository = useMemo(() => (enabled ? getInvoicesRepository(workspaceSlug) : DISABLED), [workspaceSlug, enabled]);
  return useRepositoryCollection(repository);
}
