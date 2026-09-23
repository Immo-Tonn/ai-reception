import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { AuditLogEntry } from "./types";

const cache = new Map<string, Repository<AuditLogEntry>>();

export function getAuditLogRepository(workspaceSlug: string): Repository<AuditLogEntry> {
  const key = `serviceos:${workspaceSlug}:auditLog`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<AuditLogEntry>(key, []);
    cache.set(key, repository);
  }
  return repository;
}
