"use client";

import { useCallback, useMemo } from "react";
import { useRepositoryCollection } from "@/lib/repository/useRepository";
import { getAuditLogRepository } from "./repository";
import type { AuditLogEntry } from "./types";

export function useAuditLog(workspaceSlug: string) {
  const repository = useMemo(() => getAuditLogRepository(workspaceSlug), [workspaceSlug]);
  const { items, create, refresh, loaded } = useRepositoryCollection(repository);

  const log = useCallback(
    (entry: Omit<AuditLogEntry, "id" | "timestamp">) => {
      return create({
        ...entry,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
      });
    },
    [create],
  );

  const sorted = [...items].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { entries: sorted, loaded, log, refresh };
}
