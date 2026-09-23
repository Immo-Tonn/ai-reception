import type { AppointmentStatus } from "./types";

export const statusOrder: AppointmentStatus[] = [
  "pending",
  "confirmed",
  "checkedIn",
  "inProgress",
  "completed",
  "cancelled",
  "noShow",
  "rescheduled",
];

/** Which status tokens count as "still occupying the calendar" for conflict checks. */
export const activeStatuses = new Set<AppointmentStatus>([
  "pending",
  "confirmed",
  "checkedIn",
  "inProgress",
]);

type Tone = "neutral" | "positive" | "warning" | "negative";

export const statusTone: Record<AppointmentStatus, Tone> = {
  pending: "warning",
  confirmed: "positive",
  checkedIn: "positive",
  inProgress: "positive",
  completed: "neutral",
  cancelled: "negative",
  noShow: "negative",
  rescheduled: "warning",
};
