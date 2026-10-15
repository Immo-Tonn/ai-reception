import type { Appointment, AppointmentStatus } from "./types";

/**
 * THE status-transition rules (UI and server use the same function, the server
 * is authoritative). Time is the WORKSPACE wall clock ("YYYY-MM-DD" + "HH:MM").
 *
 * Meaning of the outcome statuses:
 * - `completed` — the service took place. Only once the appointment has
 *   started (or the client is checked in / in progress): completing a future
 *   appointment would silently free a slot that is still booked.
 * - `noShow` — the client did NOT come. Only once the appointment has started,
 *   and only from pending / confirmed (a checked-in client did come).
 * - `cancelled` — called off before it took place (by the business or the
 *   client). Never for an appointment that already happened.
 * Mistakes can be corrected (no-show -> completed / confirmed, completed ->
 * confirmed, cancelled -> confirmed while still in the future); every change is
 * written to the audit log by the caller.
 * `rescheduled` is a legacy value: it can never be chosen; a move keeps the
 * appointment and changes its time.
 */

/** Why an appointment may not be physically deleted (see appointments.service `getDeleteBlockers`). */
export type DeleteBlocker = "has_history" | "online_booking" | "invoice" | "waiting_list" | "not_permitted";

export interface WallNow {
  date: string;
  time: string;
}

type Slot = Pick<Appointment, "date" | "time" | "status">;

/** Has the appointment's start time been reached (workspace wall clock)? */
export function hasStarted(appt: Pick<Appointment, "date" | "time">, now: WallNow): boolean {
  return appt.date < now.date || (appt.date === now.date && appt.time <= now.time);
}

export type TransitionReason = "not_started" | "not_allowed" | "already_happened" | "legacy";

export function checkStatusTransition(appt: Slot, to: AppointmentStatus, now: WallNow): { ok: true } | { ok: false; reason: TransitionReason } {
  const from = appt.status;
  if (from === to) return { ok: true };
  if (to === "rescheduled") return { ok: false, reason: "legacy" };
  const started = hasStarted(appt, now);
  const isToday = appt.date === now.date;
  // A legacy "rescheduled" row behaves like a confirmed one.
  const f: AppointmentStatus = from === "rescheduled" ? "confirmed" : from;

  switch (to) {
    case "pending":
      return f === "confirmed" && !started ? { ok: true } : { ok: false, reason: "not_allowed" };
    case "confirmed": {
      if (f === "pending") return { ok: true };
      // Corrections: undo a wrong no-show / completion, restore a cancelled future appointment.
      if (f === "noShow" || f === "completed") return { ok: true };
      if (f === "cancelled") return started ? { ok: false, reason: "already_happened" } : { ok: true };
      if (f === "checkedIn" || f === "inProgress") return { ok: true }; // undo check-in
      return { ok: false, reason: "not_allowed" };
    }
    case "checkedIn":
      if (f !== "pending" && f !== "confirmed") return { ok: false, reason: "not_allowed" };
      return started || isToday ? { ok: true } : { ok: false, reason: "not_started" };
    case "inProgress":
      if (f !== "confirmed" && f !== "checkedIn") return { ok: false, reason: "not_allowed" };
      return started || isToday ? { ok: true } : { ok: false, reason: "not_started" };
    case "completed":
      if (f === "checkedIn" || f === "inProgress") return { ok: true };
      if (f === "pending" || f === "confirmed" || f === "noShow") return started ? { ok: true } : { ok: false, reason: "not_started" };
      return { ok: false, reason: "not_allowed" };
    case "noShow":
      if (f === "pending" || f === "confirmed" || f === "completed") return started ? { ok: true } : { ok: false, reason: "not_started" };
      return { ok: false, reason: "not_allowed" };
    case "cancelled":
      if (f === "pending" || f === "confirmed") return started ? { ok: false, reason: "already_happened" } : { ok: true };
      return { ok: false, reason: "not_allowed" };
    default:
      return { ok: false, reason: "not_allowed" };
  }
}

export const canTransition = (appt: Slot, to: AppointmentStatus, now: WallNow) => checkStatusTransition(appt, to, now).ok;

/** Status allowed when CREATING an appointment (e.g. entering a past visit afterwards). */
export function checkInitialStatus(appt: Pick<Appointment, "date" | "time">, status: AppointmentStatus, now: WallNow): boolean {
  if (status === "rescheduled") return false;
  if (status === "pending" || status === "confirmed") return true;
  if (status === "completed" || status === "noShow") return hasStarted(appt, now);
  if (status === "checkedIn" || status === "inProgress") return hasStarted(appt, now) || appt.date === now.date;
  return status === "cancelled";
}

/** Statuses that are a real past outcome and must stay in history (never physically deleted). */
export const HISTORY_STATUSES: ReadonlySet<AppointmentStatus> = new Set(["completed", "noShow", "checkedIn", "inProgress"]);

/** Cancelled-like statuses: never block time, hidden from the calendar unless "Show cancelled" is on. */
export const CANCELLED_LIKE: ReadonlySet<AppointmentStatus> = new Set(["cancelled", "rescheduled"]);

/** Statuses a person can pick in the appointment form (no legacy value). */
export const SELECTABLE_STATUSES: readonly AppointmentStatus[] = ["pending", "confirmed", "checkedIn", "inProgress", "completed", "cancelled", "noShow"];

/** Wall clock of `timeZone` (or of this machine when null, e.g. demo workspaces). */
export function wallNow(timeZone: string | null, now: Date = new Date()): WallNow {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (!timeZone) {
    return { date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}:${pad(now.getMinutes())}` };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
