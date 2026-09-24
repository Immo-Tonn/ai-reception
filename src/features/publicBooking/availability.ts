import { getWorkspaceConfig } from "@/features/workspace/registry";
import { getAppointmentsRepository } from "@/features/appointments/repository";
import { computeAvailableSlots, type AvailableSlot } from "@/features/appointments/availability";
import { demoWorkingHours } from "@/features/workingHours/demoData";

export type { AvailableSlot };

/**
 * Browser-side counterpart of `src/server/services/availability.service.ts`
 * — same pure `computeAvailableSlots` engine, but fed from the browser's
 * own localStorage-backed appointments repository instead of the server's
 * in-memory mock one. Public Booking has to run client-side for its writes
 * to land in the same store the authenticated Calendar reads (see
 * HANDOFF_GRAPH.md §3) — this keeps the slot-picker reading from that same
 * store, so what it shows as "free" matches what a conflict check at
 * write time will actually see.
 */
export async function getClientAvailableSlots(
  workspaceSlug: string,
  serviceId: string,
  staffId: string | null,
  date: string,
): Promise<AvailableSlot[]> {
  const workspace = getWorkspaceConfig(workspaceSlug);
  const { services, staff: staffList, resources } = workspace;
  const appointments = await getAppointmentsRepository(workspaceSlug).list();

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
