import type { Appointment } from "./types";
import type { ServiceDefinition } from "@/features/services/types";
import { checkAvailability } from "@/features/workingHours/logic";
import { localIsoDate } from "@/lib/date/localIsoDate";
import type { WorkingHoursProfile } from "@/features/workingHours/types";

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function serviceBuffers(service: ServiceDefinition | undefined) {
  return {
    before: service?.bufferBeforeMinutes ?? 0,
    after: service?.bufferAfterMinutes ?? 0,
  };
}

/** [start, end) in minutes, buffers included, for overlap comparisons. */
function occupiedRange(appointment: Appointment, services: ServiceDefinition[]) {
  const service = services.find((s) => s.name === appointment.service);
  const { before, after } = serviceBuffers(service);
  const start = toMinutes(appointment.time) - before;
  const end = start + before + appointment.durationMinutes + after;
  return { start, end };
}

export interface ConflictResult {
  hasConflict: boolean;
  staffConflict?: Appointment;
  resourceConflict?: Appointment;
}

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "checkedIn", "inProgress"]);

/**
 * Staff and resource double-booking check, buffers included (§6 of the
 * Calendar task). Cancelled/no-show appointments never block a slot.
 */
export function findConflicts(
  candidate: Pick<
    Appointment,
    "id" | "staff" | "resourceId" | "date" | "time" | "durationMinutes" | "service"
  >,
  existing: Appointment[],
  services: ServiceDefinition[],
): ConflictResult {
  const candidateService = services.find((s) => s.name === candidate.service);
  const { before, after } = serviceBuffers(candidateService);
  const candidateStart = toMinutes(candidate.time) - before;
  const candidateEnd = candidateStart + before + candidate.durationMinutes + after;

  const sameDay = existing.filter(
    (item) =>
      item.id !== candidate.id && item.date === candidate.date && ACTIVE_STATUSES.has(item.status),
  );

  let staffConflict: Appointment | undefined;
  let resourceConflict: Appointment | undefined;

  for (const item of sameDay) {
    const { start, end } = occupiedRange(item, services);
    const overlaps = candidateStart < end && candidateEnd > start;
    if (!overlaps) continue;

    if (!staffConflict && item.staff === candidate.staff) {
      staffConflict = item;
    }
    if (
      !resourceConflict &&
      candidate.resourceId &&
      item.resourceId &&
      item.resourceId === candidate.resourceId
    ) {
      resourceConflict = item;
    }
  }

  return {
    hasConflict: Boolean(staffConflict || resourceConflict),
    staffConflict,
    resourceConflict,
  };
}

/**
 * Scans a staff member's working hours in 15-minute steps for the next
 * gap that fits the requested duration, has no staff/resource conflict,
 * and respects working hours — a simple, predictable suggestion rather
 * than a full optimizer.
 */
export function findNextAvailableSlot(params: {
  staff: string;
  resourceId: string | null;
  service: string;
  durationMinutes: number;
  fromDate: string;
  fromTime: string;
  existing: Appointment[];
  services: ServiceDefinition[];
  workingHours: WorkingHoursProfile[];
  maxDaysAhead?: number;
}): { date: string; time: string } | null {
  const {
    staff,
    resourceId,
    service,
    durationMinutes,
    fromDate,
    fromTime,
    existing,
    services,
    workingHours,
    maxDaysAhead = 14,
  } = params;

  const step = 15;
  let cursorDate = fromDate;
  let cursorMinutes = toMinutes(fromTime);

  for (let dayOffset = 0; dayOffset <= maxDaysAhead; dayOffset++) {
    if (dayOffset > 0) cursorMinutes = 0;

    for (let minutes = cursorMinutes; minutes < 24 * 60; minutes += step) {
      const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      const time = `${hh}:${mm}`;

      const availability = checkAvailability(staff, cursorDate, time, durationMinutes, workingHours);
      if (!availability.available) continue;

      const conflict = findConflicts(
        { id: "candidate", staff, resourceId, date: cursorDate, time, durationMinutes, service },
        existing,
        services,
      );
      if (!conflict.hasConflict) {
        return { date: cursorDate, time };
      }
    }

    const next = new Date(cursorDate + "T00:00:00");
    next.setDate(next.getDate() + 1);
    cursorDate = localIsoDate(next);
  }

  return null;
}
