import type { Appointment } from "./types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import { checkAvailability } from "@/features/workingHours/logic";
import { findConflicts } from "./conflicts";

export interface AvailableSlot {
  time: string;
  staffId: string;
  staffName: string;
  resourceId: string | null;
}

const DAY_START_MINUTES = 8 * 60;
const DAY_END_MINUTES = 20 * 60;
const STEP_MINUTES = 15;

/**
 * THE shared availability engine (§ Public Booking: "не создавать вторую
 * отдельную логику"). Pure and storage-agnostic — the Calendar's
 * conflict checks, the Public Booking slot picker, and the tests below
 * all call this same function (or the `findConflicts`/`checkAvailability`
 * it's built from). No repository/session import here on purpose, so it
 * runs in plain Node under Vitest with no Next.js/server-only shims.
 */
export function computeAvailableSlots(params: {
  service: ServiceDefinition;
  eligibleStaff: StaffMember[];
  candidateResources: ResourceDefinition[];
  existingAppointments: Appointment[];
  allServices: ServiceDefinition[];
  workingHours: WorkingHoursProfile[];
  date: string;
}): AvailableSlot[] {
  const { service, eligibleStaff, candidateResources, existingAppointments, allServices, workingHours, date } =
    params;

  const slots: AvailableSlot[] = [];

  for (const staff of eligibleStaff) {
    for (let minutes = DAY_START_MINUTES; minutes < DAY_END_MINUTES; minutes += STEP_MINUTES) {
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

      const availability = checkAvailability(staff.name, date, time, service.durationMinutes, workingHours);
      if (!availability.available) continue;

      let resourceId: string | null = null;
      if (service.requiredResourceType) {
        const freeResource = candidateResources.find(
          (resource) =>
            !findConflicts(
              {
                id: "candidate",
                staff: staff.name,
                resourceId: resource.id,
                date,
                time,
                durationMinutes: service.durationMinutes,
                service: service.name,
              },
              existingAppointments,
              allServices,
            ).hasConflict,
        );
        if (!freeResource) continue;
        resourceId = freeResource.id;
      }

      const conflict = findConflicts(
        {
          id: "candidate",
          staff: staff.name,
          resourceId,
          date,
          time,
          durationMinutes: service.durationMinutes,
          service: service.name,
        },
        existingAppointments,
        allServices,
      );
      if (conflict.hasConflict) continue;

      slots.push({ time, staffId: staff.id, staffName: staff.name, resourceId });
    }
  }

  return slots.sort((a, b) => a.time.localeCompare(b.time));
}
