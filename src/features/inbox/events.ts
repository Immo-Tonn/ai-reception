/** Business events shown in the Inbox of a REAL workspace (distinct from the demo-only Conversation model). */
export const INBOX_EVENT_TYPES = [
  "booking_created",
  "booking_cancelled",
  "booking_rescheduled",
  "booking_status",
  "waiting_list",
  "work",
  "finance",
  "system",
] as const;

export type InboxEventType = (typeof INBOX_EVENT_TYPES)[number];

/** Types a service may write through `recordInboxEvent` (booking_* come from database triggers only). */
export type ServiceInboxEventType = Extract<InboxEventType, "waiting_list" | "work" | "finance" | "system">;

/** Who made a booking change (decided by the database trigger, migration 0027). */
export type InboxInitiatorKind = "business_user" | "client_online" | "system" | "unknown";

/**
 * Snapshot of the appointment AT THE MOMENT of the event (migration 0027). Events written
 * before 0027 have no snapshot (`null`): their old values were never stored, nothing is invented.
 * Private appointments carry no client / service.
 */
export interface InboxEventDetails {
  isPrivate: boolean;
  clientId: string | null;
  clientName: string | null;
  service: string | null;
  staffName: string | null;
  /** ISO instants; `oldStartsAt` only for a reschedule. */
  startsAt: string | null;
  oldStartsAt: string | null;
  durationMinutes: number | null;
  timezone: string | null;
  /** DB status values (snake_case), `oldStatus` only when the status changed. */
  status: string | null;
  oldStatus: string | null;
  initiator: { kind: InboxInitiatorKind; role: string | null; name: string | null } | null;
}

export interface InboxEvent {
  id: string;
  type: InboxEventType;
  /** Stable machine code (booking.created, waiting.added, ...) used to localise the title. */
  code: string;
  /** Fallback title (English) when no localisation exists for `code`. */
  title: string;
  preview: string;
  entityType: string;
  entityId: string;
  clientId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string; // ISO
  details: InboxEventDetails | null;
}

export interface InboxEventList {
  events: InboxEvent[];
  unreadCount: number;
}
