import type { Appointment } from "./types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";

/**
 * Identity helpers for appointments. Stable ids win; display names are a
 * fallback ONLY for legacy records that predate `staffId`/`serviceId`/
 * `clientId` (old localStorage data). Remove the name fallbacks once the
 * shared backend migration has backfilled ids.
 */

export function isSameStaff(
  a: { staff: string; staffId?: string },
  b: { staff: string; staffId?: string },
): boolean {
  if (a.staffId && b.staffId) return a.staffId === b.staffId;
  return a.staff === b.staff;
}

export function findServiceFor(
  appointment: { service: string; serviceId?: string },
  services: ServiceDefinition[],
): ServiceDefinition | undefined {
  if (appointment.serviceId) {
    const byId = services.find((s) => s.id === appointment.serviceId);
    if (byId) return byId;
  }
  return services.find((s) => s.name === appointment.service);
}

/** Does this appointment belong to the given client record? */
export function belongsToClient(
  appointment: Pick<Appointment, "client" | "clientId">,
  client: { id: string; name: string },
): boolean {
  if (appointment.clientId) return appointment.clientId === client.id;
  return appointment.client === client.name;
}

/**
 * Fills in `staffId`/`serviceId` on legacy records from the workspace
 * catalog (by display name). Pure; returns the same object when there is
 * nothing to add. `clientId` is not backfilled here — it needs the
 * workspace's client list (see `backfillClientId`).
 */
export function backfillAppointmentIds(
  appointment: Appointment,
  catalog: { staff: StaffMember[]; services: ServiceDefinition[] },
): Appointment {
  if (appointment.staffId && appointment.serviceId) return appointment;
  const staffId = appointment.staffId ?? catalog.staff.find((s) => s.name === appointment.staff)?.id;
  const serviceId =
    appointment.serviceId ?? catalog.services.find((s) => s.name === appointment.service)?.id;
  if (staffId === appointment.staffId && serviceId === appointment.serviceId) return appointment;
  return { ...appointment, ...(staffId ? { staffId } : {}), ...(serviceId ? { serviceId } : {}) };
}
