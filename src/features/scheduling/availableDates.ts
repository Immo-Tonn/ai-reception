import { computeSlotsFor } from "@/features/appointments/availability";
import type { Appointment } from "@/features/appointments/types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import { addDays } from "@/lib/time/zonedTime";
import { isWithinHorizon } from "./intervals";

/**
 * Days (YYYY-MM-DD, workspace calendar) in [fromDate, fromDate + days) that
 * REALLY have at least one bookable slot. Pure: one set of appointments, the
 * same engine (`computeSlotsFor`) per day, so a date is offered iff its slot
 * list is non-empty. The horizon is applied here; min notice via `notBefore`.
 */
export function computeAvailableDates(params: {
  serviceId: string;
  staffId: string | null;
  services: ServiceDefinition[];
  staff: StaffMember[];
  resources: ResourceDefinition[];
  existingAppointments: Appointment[];
  workingHours: WorkingHoursProfile[];
  fromDate: string;
  days: number;
  /** Workspace-local today. */
  today: string;
  maxHorizonDays: number;
  /** Wall-clock "now + min notice" (see `nowAsWallClock`). */
  notBefore?: Date;
  slotIntervalMinutes?: number;
}): string[] {
  const { fromDate, days, today, maxHorizonDays, ...rest } = params;
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, days); i++) {
    const date = addDays(fromDate, i);
    if (!isWithinHorizon(date, today, maxHorizonDays)) continue;
    if (computeSlotsFor({ ...rest, date }).length > 0) out.push(date);
  }
  return out;
}
