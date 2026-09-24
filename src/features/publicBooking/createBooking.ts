import { getWorkspaceConfig } from "@/features/workspace/registry";
import { getAppointmentsRepository } from "@/features/appointments/repository";
import { getClientsRepository } from "@/features/clients/repository";
import { getAuditLogRepository } from "@/features/auditLog/repository";
import type { Appointment } from "@/features/appointments/types";
import type { ClientRecord } from "@/features/clients/types";
import { getClientAvailableSlots } from "./availability";

export class BookingUnavailableError extends Error {
  constructor() {
    super("That time is no longer available. Please pick another slot.");
    this.name = "BookingUnavailableError";
  }
}

export interface ClientBookingDetails {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

/**
 * Find-or-create a client **within this one workspace** (§ workspace
 * isolation — the same person booking at Salon and at Werkstatt gets two
 * separate, unlinked ClientRecords, each only visible to its own
 * business). Matches on normalized email OR normalized phone — never on
 * name alone, and never merges when the match is ambiguous (email and
 * phone point at two different existing records): in that case a new
 * record is created rather than guessing which one is "right".
 */
export async function findOrCreateClient(
  workspaceSlug: string,
  details: ClientBookingDetails,
): Promise<ClientRecord> {
  const repo = getClientsRepository(workspaceSlug);
  const existing = await repo.list();

  const normEmail = normalizeEmail(details.email);
  const normPhone = normalizePhone(details.phone);

  const byEmail = normEmail ? existing.find((c) => normalizeEmail(c.email) === normEmail) : undefined;
  const byPhone = normPhone ? existing.find((c) => normalizePhone(c.phone) === normPhone) : undefined;

  const match =
    byEmail && byPhone
      ? byEmail.id === byPhone.id
        ? byEmail
        : undefined // ambiguous — email and phone belong to different records, don't guess
      : (byEmail ?? byPhone);

  if (match) return match;

  const client: ClientRecord = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: details.name,
    email: details.email,
    phone: details.phone,
    tags: ["new"],
    lastVisit: null,
    upcoming: [],
    history: [],
    notes: "",
  };
  await repo.create(client);
  return client;
}

/**
 * Browser-side counterpart of `src/server/services/publicBooking.service.ts`
 * — writes through the SAME localStorage-backed repositories the
 * authenticated Business Calendar reads (see HANDOFF_GRAPH.md §3), so a
 * guest booking in one browser tab shows up in that browser's Calendar/
 * Clients immediately, not just "somewhere in the repository". Always
 * produces a NORMAL-visibility, MAIN-bucket, PENDING appointment — a
 * stranger booking online can never create a private/owner-only record
 * (§ default appointment status: internal=CONFIRMED, public booking=PENDING).
 */
export async function createClientBooking(
  workspaceSlug: string,
  input: {
    serviceId: string;
    staffId: string | null;
    date: string;
    time: string;
    client: ClientBookingDetails;
  },
): Promise<Appointment> {
  const slots = await getClientAvailableSlots(workspaceSlug, input.serviceId, input.staffId, input.date);
  const chosenSlot = input.staffId
    ? slots.find((s) => s.time === input.time && s.staffId === input.staffId)
    : slots.find((s) => s.time === input.time);
  if (!chosenSlot) throw new BookingUnavailableError();

  const workspace = getWorkspaceConfig(workspaceSlug);
  const service = workspace.services.find((s) => s.id === input.serviceId);
  if (!service) throw new BookingUnavailableError();

  const client = await findOrCreateClient(workspaceSlug, input.client);

  const appointment: Appointment = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    client: client.name,
    service: service.name,
    staff: chosenSlot.staffName,
    resourceId: chosenSlot.resourceId,
    date: input.date,
    time: input.time,
    durationMinutes: service.durationMinutes,
    price: service.price,
    currency: service.currency,
    notes: input.client.notes,
    visibility: "normal",
    financialBucket: "main",
    status: "pending",
    paid: false,
    seriesId: null,
    recurrence: null,
  };

  await getAppointmentsRepository(workspaceSlug).create(appointment);
  await getAuditLogRepository(workspaceSlug).create({
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
