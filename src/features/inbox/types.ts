export type ConversationChannel = "webChat" | "whatsapp" | "email" | "sms";
export type ConversationStatus = "open" | "pending" | "resolved";

export interface InboxMessage {
  id: string;
  author: "client" | "staff";
  authorName: string;
  body: string;
  createdAt: string; // ISO datetime
  internal?: boolean;
}

export interface Conversation {
  id: string;
  clientId: string | null;
  clientName: string;
  channel: ConversationChannel;
  status: ConversationStatus;
  unread: boolean;
  lastMessageAt: string; // ISO datetime
  lastMessagePreview: string;
  messages: InboxMessage[];
}
