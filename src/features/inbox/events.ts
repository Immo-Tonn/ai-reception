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
}

export interface InboxEventList {
  events: InboxEvent[];
  unreadCount: number;
}
