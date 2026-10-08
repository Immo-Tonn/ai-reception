/**
 * Shared domain contract of the staff / scheduling stage (see docs/STAFF_SCHEDULING.md).
 * Wall-clock values ("HH:mm", "YYYY-MM-DD") are ALWAYS in the WORKSPACE timezone.
 * Everything here is storage-agnostic: demo presets, real workspaces, the public
 * booking server and the business calendar all speak these shapes.
 */

export interface TimeInterval {
  start: string; // "HH:mm"
  end: string; // "HH:mm", exclusive, > start, same day
}

/** weekday 0 = Sunday ... 6 = Saturday (Date#getDay). An absent or empty list = closed that day. */
export type WeeklyIntervals = Record<number, TimeInterval[]>;

export type ScheduleMode = "inherit" | "custom";

/** Workspace-level booking rules (columns on `workspaces`, migration 0019 + auto_confirm_bookings from 0007/0013). */
export interface BookingRules {
  /** Public booking -> `confirmed` (true) or `pending` (false) after server-side validation. */
  autoConfirm: boolean;
  /** A slot must start at least this many minutes from now. 0 = no lead time. */
  minNoticeMinutes: number;
  /** Latest bookable day = today + this many days (workspace timezone). 1..180. */
  maxHorizonDays: number;
  /** Granularity of start times (5|10|15|20|30|60). NOT the service duration. */
  slotIntervalMinutes: number;
  /** Customers cannot cancel within this many hours of the start. 0 = until the start. */
  cancellationDeadlineHours: number;
  /** Customers cannot reschedule within this many hours of the start. 0 = until the start. */
  rescheduleDeadlineHours: number;
}

export const defaultBookingRules: BookingRules = {
  autoConfirm: false,
  minNoticeMinutes: 0,
  maxHorizonDays: 90,
  slotIntervalMinutes: 15,
  cancellationDeadlineHours: 0,
  rescheduleDeadlineHours: 0,
};

export const slotIntervalOptions = [5, 10, 15, 20, 30, 60] as const;

/**
 * Time off / closure. `staffId === null` = the whole business is closed.
 * `startTime`/`endTime` both null = full day(s) from startDate..endDate inclusive;
 * both set = a partial day (then startDate === endDate and endTime > startTime).
 * `reason` is private to the business (never in public payloads).
 */
export interface TimeOffEntry {
  id: string;
  staffId: string | null;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  reason?: string;
}

/** Staff as an operational-schedule person (NOT an authenticated user; `profileId` may link one later). */
export interface StaffRecord {
  id: string;
  name: string;
  title: string;
  active: boolean;
  sortOrder: number;
  colorToken: string;
  scheduleMode: ScheduleMode;
  /** Services this person performs (service_staff). Empty on the service side = everyone. */
  serviceIds: string[];
  profileId: string | null;
}

export interface ResourceRecord {
  id: string;
  name: string;
  type: string;
  description: string;
  active: boolean;
  sortOrder: number;
  /** Services that may use this resource (service_resources). */
  serviceIds: string[];
}
