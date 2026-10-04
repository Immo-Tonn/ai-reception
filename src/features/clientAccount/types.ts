/**
 * Contract between the client-account server layer and the /client UI.
 * A MyBooking is the CUSTOMER-facing projection of an appointment (see migration 0018,
 * `list_my_bookings`): nothing internal (notes, bucket, visibility rules, other clients).
 */
export type MyBookingStatus =
  | "pending" | "confirmed" | "checked_in" | "in_progress" | "completed" | "cancelled" | "no_show" | "rescheduled";

export interface MyBooking {
  id: string;
  workspaceSlug: string;
  businessName: string;
  /** IANA zone of the business: `date`/`time` below are THIS zone's wall clock. */
  timezone: string;
  startsAt: string; // ISO instant
  endsAt: string; // ISO instant
  date: string; // YYYY-MM-DD in `timezone`
  time: string; // HH:mm in `timezone`
  endTime: string; // HH:mm in `timezone`
  status: MyBookingStatus;
  serviceId: string | null;
  serviceName: string | null;
  staffId: string | null;
  staffName: string | null;
  resourceId: string | null;
  price: number;
  currency: string;
  /** Computed on the server in the BUSINESS timezone (never the browser's): starts_at is still in the future. */
  isUpcoming: boolean;
  canCancel: boolean;
  canReschedule: boolean;
}

export type ClientActionErrorCode =
  | "unauthenticated"
  | "invalid_input"
  | "not_found"
  | "not_manageable" // past, already cancelled/completed, or not the customer's to change
  | "slot_unavailable"
  | "rate_limited"
  | "unavailable" // backend not configured / transient
  | "unknown";

export type ClientActionResult<T> = { ok: true; data: T } | { ok: false; code: ClientActionErrorCode };
