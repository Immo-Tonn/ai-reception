import type { Locale } from "@/lib/i18n";

/**
 * Channels the architecture is prepared for. Only the Console/Mock
 * adapter exists today — no real EMAIL/SMS/PUSH provider is connected,
 * and IN_APP has no adapter yet (§ foundation only).
 */
export type NotificationChannel = "EMAIL" | "SMS" | "PUSH" | "IN_APP";

export type NotificationEventType =
  | "BOOKING_CONFIRMED"
  | "BOOKING_RESCHEDULED"
  | "BOOKING_CANCELLED"
  /** Template foundation only — there is NO scheduler yet; it arrives
   * with the backend (Supabase) and nothing emits this event today. */
  | "BOOKING_REMINDER";

/**
 * Everything a client-facing booking notification may contain — and
 * nothing more. Built explicitly (never by spreading an Appointment) so
 * internal notes, visibility, financial bucket, price/paid state and
 * other private business metadata can never leak into a message sent
 * to a client (§ see `buildBookingPayload`).
 */
export interface BookingNotificationPayload {
  workspaceSlug: string;
  businessName: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  serviceName: string;
  /** ISO date, e.g. "2026-09-29". */
  date: string;
  /** "HH:mm". */
  time: string;
  staffName: string;
  appointmentId: string;
}

export interface NotificationEvent {
  type: NotificationEventType;
  payload: BookingNotificationPayload;
  locale: Locale;
}

/** Per-person channel preferences — foundation, no Settings UI yet. */
export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  push: boolean;
}

/** A message already rendered for one channel, ready for a provider. */
export interface RenderedNotification {
  channel: NotificationChannel;
  event: NotificationEvent;
  /** Recipient address for the channel (email address / phone number). */
  to: string;
  subject?: string;
  /** Plain-text body (always present). */
  text: string;
  /** Optional HTML body (email only). */
  html?: string;
}

export interface NotificationSendResult {
  channel: NotificationChannel;
  ok: boolean;
  /**
   * Whether a real message actually left the system. The Console/Mock
   * provider returns `ok: true, delivered: false` — it proved the flow,
   * it did NOT send anything — so the UI must never claim "email sent"
   * based on `ok` alone.
   */
  delivered: boolean;
  error?: string;
}
