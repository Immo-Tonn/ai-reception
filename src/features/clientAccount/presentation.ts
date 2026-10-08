import type { AppointmentStatus } from "@/features/appointments/types";
import type { ClientActionErrorCode, MyBooking, MyBookingStatus } from "./types";

const STATUS_MAP: Record<MyBookingStatus, AppointmentStatus> = {
  pending: "pending",
  confirmed: "confirmed",
  checked_in: "checkedIn",
  in_progress: "inProgress",
  completed: "completed",
  cancelled: "cancelled",
  no_show: "noShow",
  rescheduled: "rescheduled",
};

/** DB status (snake_case) -> the UI status used by StatusBadge / appointmentStatus labels. */
export function toAppointmentStatus(status: MyBookingStatus): AppointmentStatus {
  return STATUS_MAP[status];
}

const FINISHED: ReadonlySet<MyBookingStatus> = new Set(["completed", "cancelled", "no_show", "rescheduled"]);

/**
 * Upcoming = still ahead in the BUSINESS timezone (server-computed `isUpcoming`) AND not finished.
 * A cancelled future booking therefore lands under Past/Cancelled.
 */
export function splitMyBookings(bookings: MyBooking[]): { upcoming: MyBooking[]; past: MyBooking[] } {
  const byStart = (a: MyBooking, b: MyBooking) => a.startsAt.localeCompare(b.startsAt);
  const upcoming = bookings.filter((b) => b.isUpcoming && !FINISHED.has(b.status)).sort(byStart);
  const past = bookings.filter((b) => !(b.isUpcoming && !FINISHED.has(b.status))).sort((a, b) => byStart(b, a));
  return { upcoming, past };
}

export type ClientErrorMessageKey =
  | "errUnauthenticated"
  | "errInvalid"
  | "errNotFound"
  | "errNotManageable"
  | "errSlotUnavailable"
  | "errRateLimited"
  | "errUnavailable"
  | "errUnknown";

const ERROR_KEYS: Record<ClientActionErrorCode, ClientErrorMessageKey> = {
  unauthenticated: "errUnauthenticated",
  invalid_input: "errInvalid",
  not_found: "errNotFound",
  not_manageable: "errNotManageable",
  slot_unavailable: "errSlotUnavailable",
  rate_limited: "errRateLimited",
  unavailable: "errUnavailable",
  unknown: "errUnknown",
};

export function clientErrorKey(code: ClientActionErrorCode): ClientErrorMessageKey {
  return ERROR_KEYS[code];
}

/** Whether the viewer can show the zone label: only when the browser zone differs from the business zone. */
export function showZoneLabel(businessZone: string, browserZone: string | null): boolean {
  return Boolean(browserZone) && browserZone !== businessZone;
}
