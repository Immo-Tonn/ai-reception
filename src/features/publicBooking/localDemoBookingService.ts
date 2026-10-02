import { findWorkspaceConfig } from "@/features/workspace/registry";
import { getAppointmentsRepository } from "@/features/appointments/repository";
import { getClientsRepository } from "@/features/clients/repository";
import { getAuditLogRepository } from "@/features/auditLog/repository";
import {
  computeAvailableSlots,
  pickSlot,
  type AvailableSlot,
} from "@/features/appointments/availability";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import type { PublicBookingService } from "./bookingService";
import {
  BookingUnavailableError,
  buildNewClientRecord,
  buildPublicAppointment,
  buildPublicBookingAuditSummary,
  buildPublicBookingResult,
  matchExistingClient,
  type ClientBookingDetails,
} from "./bookingRules";

/**
 * LOCAL / DEMO adapter of `PublicBookingService`. Reads and writes the
 * visitor's own browser localStorage via the same repositories the
 * authenticated Calendar reads — which is why it only "works" when the
 * visitor and the business happen to be the same browser. It is NOT
 * production persistence; see HANDOFF_GRAPH.md. Replace with a
 * shared-backend adapter, do not extend this one.
 */
function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function loadSlots(
  workspaceSlug: string,
  serviceId: string,
  staffId: string | null,
  date: string,
): Promise<AvailableSlot[]> {
  const workspace = findWorkspaceConfig(workspaceSlug);
  if (!workspace) return [];
  const { services, staff: staffList, resources } = workspace;

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
    existingAppointments: await getAppointmentsRepository(workspaceSlug).list(),
    allServices: services,
    workingHours: demoWorkingHours,
    date,
    notBefore: new Date(),
  });
}

async function findOrCreateClient(workspaceSlug: string, details: ClientBookingDetails) {
  const repo = getClientsRepository(workspaceSlug);
  const match = matchExistingClient(await repo.list(), details);
  if (match) return match;
  const client = buildNewClientRecord(newId(), details);
  await repo.create(client);
  return client;
}

export const localDemoBookingService: PublicBookingService = {
  getAvailableSlots: loadSlots,

  async createBooking(workspaceSlug, request) {
    const workspace = findWorkspaceConfig(workspaceSlug);
    const service = workspace?.services.find((s) => s.id === request.serviceId);
    if (!workspace || !service) throw new BookingUnavailableError();

    const slots = await loadSlots(workspaceSlug, request.serviceId, request.staffId, request.date);
    const chosenSlot = pickSlot(slots, request.time, request.staffId);
    if (!chosenSlot) throw new BookingUnavailableError();

    const client = await findOrCreateClient(workspaceSlug, request.client);
    const appointment = buildPublicAppointment({
      id: newId(),
      service,
      slot: chosenSlot,
      date: request.date,
      time: request.time,
      client,
      notes: request.client.notes,
    });

    await getAppointmentsRepository(workspaceSlug).create(appointment);
    await getAuditLogRepository(workspaceSlug).create({
      id: newId(),
      timestamp: new Date().toISOString(),
      action: "created",
      entityType: "appointment",
      entityId: appointment.id,
      summary: buildPublicBookingAuditSummary(appointment),
      source: "public",
    });

    return buildPublicBookingResult(appointment);
  },
};
