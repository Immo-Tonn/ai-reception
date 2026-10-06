import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import { createRemoteRepository } from "@/lib/repository/createRemoteRepository";
import type { Repository } from "@/lib/repository/types";
import type { AuditLogEntry } from "./types";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { listAuditLogAction } from "@/server/actions/auditLog.actions";

const cache = new Map<string, Repository<AuditLogEntry>>();

export function getAuditLogRepository(workspaceSlug: string): Repository<AuditLogEntry> {
  const key = `serviceos:${workspaceSlug}:auditLog`;
  let repository = cache.get(key);
  if (!repository) {
    // Real workspaces: entries are written by the server services
    // themselves (so they can't be forged or skipped); the browser only reads.
    repository = isDemoWorkspaceSlug(workspaceSlug)
      ? createLocalRepository<AuditLogEntry>(key, [])
      : createRemoteRepository<AuditLogEntry>({
          async list() {
            const result = await listAuditLogAction(workspaceSlug);
            // Roles without audit-log access simply see an empty history.
            if (!result.ok && result.code === "forbidden") return { ok: true, data: [] };
            return result;
          },
        });
    cache.set(key, repository);
  }
  return repository;
}
