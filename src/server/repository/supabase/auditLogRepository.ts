import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Repository } from "@/lib/repository/types";
import type { AuditLogEntry } from "@/features/auditLog/types";
import { isUuid } from "./clientsRepository";

/** Real Supabase-backed Repository<AuditLogEntry> over `audit_logs`. */

interface AuditRow {
  id: string;
  action: AuditLogEntry["action"];
  entity_type: AuditLogEntry["entityType"];
  entity_id: string;
  summary: string;
  source: AuditLogEntry["source"];
  created_at: string;
}

function fromRow(row: AuditRow): AuditLogEntry {
  return {
    id: row.id,
    timestamp: row.created_at,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    source: row.source,
  };
}

const COLUMNS = "id, action, entity_type, entity_id, summary, source, created_at";
const cache = new Map<string, Repository<AuditLogEntry>>();

export function getSupabaseAuditLogRepository(workspaceId: string): Repository<AuditLogEntry> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;

  const admin = createSupabaseAdminClient();

  const repo: Repository<AuditLogEntry> = {
    async list() {
      const { data, error } = await admin
        .from("audit_logs")
        .select(COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return ((data ?? []) as AuditRow[]).map(fromRow);
    },

    async get(id) {
      if (!isUuid(id)) return undefined;
      const { data, error } = await admin
        .from("audit_logs")
        .select(COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? fromRow(data as AuditRow) : undefined;
    },

    async create(item) {
      const { data, error } = await admin
        .from("audit_logs")
        .insert({
          workspace_id: workspaceId,
          action: item.action,
          entity_type: item.entityType,
          entity_id: item.entityId,
          summary: item.summary,
          source: item.source,
        })
        .select(COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      return fromRow(data as AuditRow);
    },

    async update() {
      throw new Error("Audit log entries are immutable.");
    },
    async remove() {
      throw new Error("Audit log entries are immutable.");
    },
    async replaceAll() {
      throw new Error("Audit log entries are immutable.");
    },
  };

  cache.set(workspaceId, repo);
  return repo;
}
