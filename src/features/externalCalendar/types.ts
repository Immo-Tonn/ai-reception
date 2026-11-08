/**
 * External calendars, one direction only: provider (Google) -> ServiceOS
 * availability. ServiceOS reads BUSY intervals (start/end) and nothing else —
 * no titles, descriptions, attendees or locations ever reach ServiceOS.
 * ServiceOS never writes to the provider and the provider never changes
 * ServiceOS appointments. Design: docs/EXTERNAL_CALENDAR.md.
 */

export type ExternalCalendarProviderId = "google";

/** One busy interval as absolute instants (ISO 8601, UTC). `start < end`. */
export interface BusyInterval {
  start: string;
  end: string;
}

/**
 * - `connected`: last refresh succeeded (or none attempted yet since connecting).
 * - `error`: last refresh failed transiently (network, 5xx, quota). Cached busy time may still be used while fresh enough.
 * - `revoked`: the person withdrew access at the provider (or the grant expired). Never used until reconnected.
 */
export type ExternalCalendarStatus = "connected" | "error" | "revoked";

/** Stable codes; the UI localizes them. Never a raw provider message. */
export type ExternalCalendarErrorCode =
  | "revoked"
  | "unavailable"
  | "rate_limited"
  | "calendar_not_found"
  | "invalid_response"
  | "not_configured";

/**
 * What the business UI may know about a connection. No tokens, no calendar ids
 * or names (those can be personal and stay with the connecting person).
 */
export interface ExternalCalendarConnectionSummary {
  staffId: string;
  provider: ExternalCalendarProviderId;
  status: ExternalCalendarStatus;
  calendarCount: number;
  lastSuccessAt: string | null;
  lastErrorCode: ExternalCalendarErrorCode | null;
  lastErrorAt: string | null;
  connectedAt: string;
}

/** A ServiceOS appointment that overlaps the person's external busy time (shown to the owner; never changed automatically). */
export interface ExternalCalendarConflict {
  appointmentId: string;
  staffId: string;
  date: string;
  time: string;
  durationMinutes: number;
  service: string;
}
