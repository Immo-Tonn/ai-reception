import { resolveToday } from "@/lib/time/zonedTime";

/**
 * A booking's `date` + `time` are the BUSINESS wall clock. `timezone` (IANA)
 * is the business zone saved with the record when known; legacy/demo records
 * have none and fall back to the browser-local day.
 */
export interface BookingWallTime {
  date: string;
  time: string;
  timezone?: string | null;
}

const INACTIVE = new Set(["cancelled", "completed", "noShow"]);

export function isInactiveStatus(status: string): boolean {
  return INACTIVE.has(status);
}

/** Business-calendar "today" for one booking record. */
export function bookingToday(now: Date, timezone?: string | null): string {
  return resolveToday(now, timezone ?? null);
}

export function isUpcomingBooking(
  booking: BookingWallTime & { status: string },
  now: Date,
): boolean {
  return booking.date >= bookingToday(now, booking.timezone) && !isInactiveStatus(booking.status);
}

export function splitBookings<T extends BookingWallTime & { status: string }>(
  items: T[],
  now: Date,
): { upcoming: T[]; past: T[] } {
  const sorted = [...items].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return {
    upcoming: sorted.filter((b) => isUpcomingBooking(b, now)),
    past: sorted.filter((b) => !isUpcomingBooking(b, now)),
  };
}
