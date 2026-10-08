import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getServerInboxEventsRepository } from "@/server/repository/registry";
import { RepositoryNotFoundError } from "@/server/repository/errors";
import type { InboxEvent, InboxEventList, ServiceInboxEventType } from "@/features/inbox/events";

const EMPTY: InboxEventList = { events: [], unreadCount: 0 };

/** Real workspaces: business events (bookings, waiting list, ...). Demo: none (its Conversation fixtures are separate). */
export async function listInboxEvents(session: Session): Promise<InboxEventList> {
  assertCan(session.role, "appointments.view");
  if (isDemoWorkspaceSlug(session.workspaceId)) return EMPTY;
  return getServerInboxEventsRepository(session.workspaceId).list();
}

export async function getInboxUnreadCount(session: Session): Promise<number> {
  assertCan(session.role, "appointments.view");
  if (isDemoWorkspaceSlug(session.workspaceId)) return 0;
  return getServerInboxEventsRepository(session.workspaceId).unreadCount();
}

export async function setInboxEventRead(session: Session, id: string, isRead: boolean): Promise<InboxEvent> {
  assertCan(session.role, "appointments.edit");
  if (isDemoWorkspaceSlug(session.workspaceId)) throw new RepositoryNotFoundError("inbox.setRead");
  const updated = await getServerInboxEventsRepository(session.workspaceId).setRead(id, isRead);
  if (!updated) throw new RepositoryNotFoundError("inbox.setRead");
  return updated;
}

/** Returns how many events were marked. */
export async function markAllInboxEventsRead(session: Session): Promise<number> {
  assertCan(session.role, "appointments.edit");
  if (isDemoWorkspaceSlug(session.workspaceId)) return 0;
  return getServerInboxEventsRepository(session.workspaceId).markAllRead();
}

export interface RecordInboxEventInput {
  type: ServiceInboxEventType;
  /** Machine code for localisation, e.g. "waiting.added". */
  code?: string;
  /** Short, generic English fallback title. No personal data. */
  title: string;
  /** <= 200 chars. At most a first name plus non-sensitive facts (service, date). */
  preview?: string;
  entityType?: string;
  entityId?: string;
  clientId?: string | null;
  /** Unique per workspace; the same key is recorded once ("waiting:<id>:created"). */
  dedupeKey: string;
}

/**
 * The ONLY way services (waiting list, work, finance, system) put an event into the Inbox. Runs as the
 * caller through the permission-checked `record_inbox_event` RPC (waiting_list: appointments.create|edit,
 * work: clients.edit, finance: finance.edit, system: settings.manage); booking events are trigger-only.
 * Never throws for infrastructure problems: an Inbox hiccup must not fail the business action.
 * Returns true when a new event was stored, false for a duplicate / demo / failure.
 */
export async function recordInboxEvent(session: Session, input: RecordInboxEventInput): Promise<boolean> {
  if (isDemoWorkspaceSlug(session.workspaceId)) return false;
  try {
    return await getServerInboxEventsRepository(session.workspaceId).record({
      type: input.type,
      code: input.code ?? "",
      title: input.title,
      preview: (input.preview ?? "").slice(0, 200),
      entityType: input.entityType ?? "",
      entityId: input.entityId ?? "",
      clientId: input.clientId ?? null,
      dedupeKey: input.dedupeKey,
    });
  } catch (error) {
    console.error("[inbox] event not recorded:", error instanceof Error ? error.name : "unknown");
    return false;
  }
}
