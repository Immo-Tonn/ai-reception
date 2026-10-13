import type { Appointment } from "@/features/appointments/types";
import type { ServiceDefinition } from "@/features/services/types";
import { findConflicts } from "@/features/appointments/conflicts";
import type { ExternalCalendarConflict } from "./types";

const ACTIVE = new Set(["pending", "confirmed", "checkedIn", "inProgress"]);

/**
 * ServiceOS appointments that overlap their staff member's external busy time
 * (buffers included). Shown to the owner to decide; ServiceOS never cancels or
 * moves anything because of an external event.
 */
export function findExternalConflicts(
  appointments: Appointment[],
  externalBusy: Appointment[],
  services: ServiceDefinition[],
): ExternalCalendarConflict[] {
  if (externalBusy.length === 0) return [];
  const out: ExternalCalendarConflict[] = [];
  for (const appt of appointments) {
    if (!appt.staffId || !ACTIVE.has(appt.status)) continue;
    const hit = findConflicts({ ...appt, resourceId: null }, externalBusy, services).staffConflict;
    if (!hit) continue;
    out.push({
      appointmentId: appt.id,
      staffId: appt.staffId,
      date: appt.date,
      time: appt.time,
      durationMinutes: appt.durationMinutes,
      service: appt.service,
    });
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
