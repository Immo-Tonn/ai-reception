import "server-only";
import {
  getServerAppointmentsRepository,
  getServerClientsRepository,
  getServerAuditLogRepository,
  getServerServicesRepository,
} from "@/server/repository/registry";
import { publicBookingSchema, type PublicBookingInput } from "@/server/validation/availability.schema";
import { getAvailableSlots } from "./availability.service";
import { pickSlot } from "@/features/appointments/availability";
import type { Appointment } from "@/features/appointments/types";
import {
  BookingUnavailableError,
  buildNewClientRecord,
  buildPublicAppointment,
  buildPublicBookingAuditSummary,
  matchExistingClient,
} from "@/features/publicBooking/bookingRules";

export { BookingUnavailableError };

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * The server-side booking write path — currently NOT called by any UI
 * (the wizard goes through `PublicBookingService`, whose only adapter is
 * the browser-local demo one). It is the intended body of the future
 * shared-backend adapter and already shares all rules with it via
 * `bookingRules`. No
 * `Session`/role on purpose — an anonymous website visitor calls this.
 * It can only ever produce a NORMAL-visibility, MAIN-bucket, pending
 * appointment: a stranger booking a haircut can never create a private
 * or owner-only record, regardless of what the request body claims.
 */
export async function createPublicBooking(
  workspaceId: string,
  input: PublicBookingInput,
): Promise<Appointment> {
  const data = publicBookingSchema.parse(input);

  // Re-check availability at write time — the slot list the browser saw
  // may be stale (someone else booked it a second ago).
  const slots = await getAvailableSlots(workspaceId, data.serviceId, data.staffId, data.date);
  const chosenSlot = pickSlot(slots, data.time, data.staffId);
  if (!chosenSlot) throw new BookingUnavailableError();

  const servicesRepo = getServerServicesRepository(workspaceId);
  const service = (await servicesRepo.list()).find((s) => s.id === data.serviceId);
  if (!service) throw new BookingUnavailableError();

  // Same find-or-create rules as the browser adapter (email OR phone,
  // ambiguous -> new record) — shared via bookingRules, not re-implemented.
  const clientsRepo = getServerClientsRepository(workspaceId);
  let client = matchExistingClient(await clientsRepo.list(), data.client);
  if (!client) {
    client = buildNewClientRecord(newId(), data.client);
    await clientsRepo.create(client);
  }

  const appointment = buildPublicAppointment({
    id: newId(),
    service,
    slot: chosenSlot,
    date: data.date,
    time: data.time,
    client,
    notes: data.client.notes,
  });

  await getServerAppointmentsRepository(workspaceId).create(appointment);
  await getServerAuditLogRepository(workspaceId).create({
    id: newId(),
    timestamp: new Date().toISOString(),
    action: "created",
    entityType: "appointment",
    entityId: appointment.id,
    summary: buildPublicBookingAuditSummary(appointment),
    source: "public",
  });

  return appointment;
}
