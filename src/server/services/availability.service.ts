import "server-only";
import {
  getServerAppointmentsRepository,
  getServerServicesRepository,
  getServerStaffRepository,
  getServerResourcesRepository,
} from "@/server/repository/registry";
import { computeAvailableSlots, type AvailableSlot } from "@/features/appointments/availability";
import { demoWorkingHours } from "@/features/workingHours/demoData";

export type { AvailableSlot };

/**
 * Thin repository-fetching wrapper around the shared, pure
 * `computeAvailableSlots` engine (features/appointments/availability.ts)
 * — used by both the authenticated Calendar's conflict preview and
 * Public Booking's slot picker. All the actual logic lives in the pure
 * function so it can be unit-tested without a server context.
 */
export async function getAvailableSlots(
  workspaceId: string,
  serviceId: string,
  staffId: string | null,
  date: string,
): Promise<AvailableSlot[]> {
  const [services, staffList, appointments, resources] = await Promise.all([
    getServerServicesRepository(workspaceId).list(),
    getServerStaffRepository(workspaceId).list(),
    getServerAppointmentsRepository(workspaceId).list(),
    getServerResourcesRepository(workspaceId).list(),
  ]);

  const service = services.find((s) => s.id === serviceId);
  if (!service) return [];

  const eligibleStaff = staffId
    ? staffList.filter((s) => s.id === staffId)
    : service.allowedStaffIds.length > 0
      ? staffList.filter((s) => service.allowedStaffIds.includes(s.id))
      : staffList;

  const candidateResources = service.requiredResourceType
    ? resources.filter((r) => r.type === service.requiredResourceType)
    : [];

  return computeAvailableSlots({
    service,
    eligibleStaff,
    candidateResources,
    existingAppointments: appointments,
    allServices: services,
    workingHours: demoWorkingHours,
    date,
  });
}
