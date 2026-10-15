import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { INBOX_EVENT_TYPES, type InboxEvent, type InboxEventDetails, type InboxEventList, type InboxEventType, type InboxInitiatorKind, type ServiceInboxEventType } from "@/features/inbox/events";
import { isUuid } from "./appointmentsMapper";
import { toRepositoryError } from "./errors";

interface InboxEventRow {
  id: string;
  type: string;
  code: string;
  title: string;
  preview: string;
  entity_type: string;
  entity_id: string;
  client_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  /** Absent before migration 0027 is applied; `{}` for older events. */
  details?: unknown;
}

const INITIATOR_KINDS: readonly InboxInitiatorKind[] = ["business_user", "client_online", "system", "unknown"];
const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null);

/** Defensive parse of the trigger snapshot; anything unexpected becomes null (never guessed). */
export function inboxDetailsFromJson(raw: unknown): InboxEventDetails | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  if (d.v !== 1) return null;
  const isPrivate = d.private === true;
  const ini = d.initiator && typeof d.initiator === "object" ? (d.initiator as Record<string, unknown>) : null;
  const kind = ini && INITIATOR_KINDS.includes(ini.kind as InboxInitiatorKind) ? (ini.kind as InboxInitiatorKind) : null;
  return {
    isPrivate,
    clientId: isPrivate ? null : str(d.client_id, 64),
    clientName: isPrivate ? null : str(d.client_name, 120),
    service: isPrivate ? null : str(d.service, 80),
    staffName: str(d.staff_name, 80),
    startsAt: str(d.starts_at, 40),
    oldStartsAt: str(d.old_starts_at, 40),
    durationMinutes: typeof d.duration_minutes === "number" && Number.isFinite(d.duration_minutes) ? d.duration_minutes : null,
    timezone: str(d.timezone, 64),
    status: str(d.status, 30),
    oldStatus: str(d.old_status, 30),
    initiator: kind ? { kind, role: str(ini?.role, 30), name: str(ini?.name, 80) } : null,
  };
}

export function inboxEventFromRow(row: InboxEventRow): InboxEvent {
  return {
    id: row.id,
    type: ((INBOX_EVENT_TYPES as readonly string[]).includes(row.type) ? row.type : "system") as InboxEventType,
    code: row.code,
    title: row.title,
    preview: row.preview,
    entityType: row.entity_type,
    entityId: row.entity_id,
    clientId: row.client_id,
    isRead: row.is_read,
    readAt: row.read_at,
    createdAt: row.created_at,
    details: inboxDetailsFromJson(row.details),
  };
}

export interface RecordInboxEventParams {
  type: ServiceInboxEventType;
  code: string;
  title: string;
  preview: string;
  entityType: string;
  entityId: string;
  clientId: string | null;
  dedupeKey: string;
}

export interface InboxEventsRepository {
  list(limit?: number): Promise<InboxEventList>;
  setRead(id: string, isRead: boolean): Promise<InboxEvent | undefined>;
  markAllRead(): Promise<number>;
  unreadCount(): Promise<number>;
  /** Writes via the permission-checked `record_inbox_event` RPC. Returns false when the event already existed. */
  record(params: RecordInboxEventParams): Promise<boolean>;
}

/** Supabase adapter; runs as the signed-in user (RLS: read appointments.view, mark read appointments.edit). */
export function createSupabaseInboxEventsRepository(
  workspaceId: string,
  getClient: () => Promise<SupabaseClient> = createSupabaseServerClient,
): InboxEventsRepository {
  async function unread(client: SupabaseClient): Promise<number> {
    const { data, error } = await client.from("inbox_events").select("id").eq("workspace_id", workspaceId).eq("is_read", false);
    if (error) throw toRepositoryError(error, "inbox.unreadCount");
    return (data ?? []).length;
  }

  return {
    async list(limit = 200) {
      const client = await getClient();
      const [rows, count] = await Promise.all([
        client
          .from("inbox_events")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(Math.min(Math.max(limit, 1), 200)),
        unread(client),
      ]);
      if (rows.error) throw toRepositoryError(rows.error, "inbox.list");
      return { events: ((rows.data as InboxEventRow[]) ?? []).map(inboxEventFromRow), unreadCount: count };
    },

    async setRead(id, isRead) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const { data, error } = await client
        .from("inbox_events")
        .update({ is_read: isRead })
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) throw toRepositoryError(error, "inbox.setRead");
      return data ? inboxEventFromRow(data as InboxEventRow) : undefined;
    },

    async markAllRead() {
      const client = await getClient();
      const { data, error } = await client
        .from("inbox_events")
        .update({ is_read: true })
        .eq("workspace_id", workspaceId)
        .eq("is_read", false)
        .select("id");
      if (error) throw toRepositoryError(error, "inbox.markAllRead");
      return (data ?? []).length;
    },

    async unreadCount() {
      return unread(await getClient());
    },

    async record(params) {
      const client = await getClient();
      const { data, error } = await client.rpc("record_inbox_event", {
        p_workspace_id: workspaceId,
        p_type: params.type,
        p_code: params.code,
        p_title: params.title,
        p_preview: params.preview,
        p_entity_type: params.entityType,
        p_entity_id: params.entityId,
        p_client_id: params.clientId,
        p_dedupe_key: params.dedupeKey,
      });
      if (error) throw toRepositoryError(error, "inbox.record");
      return data !== null && data !== undefined;
    },
  };
}
