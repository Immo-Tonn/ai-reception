import "server-only";
import {
  getServerAppointmentsRepository,
  getServerClientsRepository,
  getServerAuditLogRepository,
  getServerServicesRepository,
} from "@/server/repository/registry";
import { publicBookingSchema, type PublicBookingInput } from "@/server/validation/availability.schema";
import { getAvailableSlots } from "./availability.service";
import type { Appointment } from "@/features/appointments/types";
import type { ClientRecord } from "@/features/clients/types";

export class BookingUnavailableError extends Error {
  constructor() {
    super("That time is no longer available. Please pick another slot.");
    this.name = "BookingUnavailableError";
  }
}

/**
 * The public-facing booking write path (§2/§3 Public Booking). No
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
  const chosenSlot = data.staffId
    ? slots.find((s) => s.time === data.time && s.staffId === data.staffId)
    : slots.find((s) => s.time === data.time);
  if (!chosenSlot) throw new BookingUnavailableError();

  const servicesRepo = getServerServicesRepository(workspaceId);
  const service = (await servicesRepo.list()).find((s) => s.id === data.serviceId);
  if (!service) throw new BookingUnavailableError();

  // Find-or-create the client by email, same as a staff member would do
  // manually — the public flow and the internal flow end up sharing one
  // client list, not a shadow copy.
  const clientsRepo = getServerClientsRepository(workspaceId);
  const existingClients = await clientsRepo.list();
  let client = existingClients.find(
    (c) => c.email.toLowerCase() === data.client.email.toLowerCase(),
  );
  if (!client) {
    client = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: data.client.name,
      email: data.client.email,
      phone: data.client.phone,
      tags: ["new"],
      lastVisit: null,
      upcoming: [],
      history: [],
      notes: "",
    } satisfies ClientRecord;
    await clientsRepo.create(client);
  }

  const appointment: Appointment = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    client: client.name,
    service: service.name,
    staff: chosenSlot.staffName,
    resourceId: chosenSlot.resourceId,
    date: data.date,
    time: data.time,
    durationMinutes: service.durationMinutes,
    price: service.price,
    currency: service.currency,
    notes: data.client.notes,
    visibility: "normal",
    financialBucket: "main",
    status: "pending",
    paid: false,
    seriesId: null,
    recurrence: null,
  };

  const appointmentsRepo = getServerAppointmentsRepository(workspaceId);
  await appointmentsRepo.create(appointment);

  const auditRepo = getServerAuditLogRepository(workspaceId);
  await auditRepo.create({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    action: "created",
    entityType: "appointment",
    entityId: appointment.id,
    summary: `Public booking: ${appointment.client} · ${appointment.service} · ${appointment.date} ${appointment.time}`,
    source: "public",
  });

  return appointment;
}
