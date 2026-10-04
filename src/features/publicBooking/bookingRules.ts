import type { Appointment } from "@/features/appointments/types";
import type { AvailableSlot } from "@/features/appointments/availability";
import type { ClientRecord } from "@/features/clients/types";
import type { ServiceDefinition } from "@/features/services/types";

/**
 * Storage-free business rules of a public booking. EVERY booking write
 * path (today: the browser demo adapter; later: the shared-backend adapter;
 * and the server `createPublicBooking`) builds its records through these
 * functions, so the rules cannot drift between implementations. Nothing
 * here touches localStorage, a repository, or the clock.
 */

export class BookingUnavailableError extends Error {
  constructor() {
    super("That time is no longer available. Please pick another slot.");
    this.name = "BookingUnavailableError";
  }
}

/** The visitor (or their address) made too many booking attempts; try again later. */
export class BookingRateLimitedError extends Error {
  constructor() {
    super("Too many attempts. Please try again later.");
    this.name = "BookingRateLimitedError";
  }
}

export interface ClientBookingDetails {
  name: string;
  email: string;
  phone: string;
  notes: string;
}

/** What the booking UI submits. Same shape for every adapter. */
export interface PublicBookingRequest {
  serviceId: string;
  /** `null` = any available specialist. */
  staffId: string | null;
  date: string;
  time: string;
  client: ClientBookingDetails;
}

/** What the booking UI gets back — enough for the success screen, nothing internal. */
export interface PublicBookingResult {
  appointmentId: string;
  serviceId: string;
  serviceName: string;
  staffId: string;
  staffName: string;
  date: string;
  time: string;
  status: Appointment["status"];
  /**
   * What happened to the "keep this booking in My bookings" link (server-side; the claim token
   * itself never reaches the browser): "linked" = attached to the signed-in client account,
   * "pending" = remembered in an httpOnly cookie until the visitor signs in / signs up,
   * "none" = nothing was stored.
   */
  claim?: "linked" | "pending" | "none";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

/**
 * Find the existing client **within one workspace** (same person at two
 * businesses = two unlinked records). E-mail is the unique identity inside a
 * workspace (the database enforces one client per e-mail), so an e-mail match
 * WINS; the normalized phone is the fallback. Never matches on name alone.
 *
 * (Earlier versions refused to guess when e-mail and phone pointed at two
 * different records and created a third. With e-mail unique per workspace
 * that record could not be stored, so the e-mail owner is chosen instead.
 * `public.create_public_booking` implements the same rule in SQL; a test
 * compares both.)
 */
export function matchExistingClient(
  existing: ClientRecord[],
  details: Pick<ClientBookingDetails, "email" | "phone">,
): ClientRecord | undefined {
  const normEmail = normalizeEmail(details.email);
  const normPhone = normalizePhone(details.phone);

  const byEmail = normEmail ? existing.find((c) => normalizeEmail(c.email) === normEmail) : undefined;
  if (byEmail) return byEmail;
  return normPhone ? existing.find((c) => normalizePhone(c.phone) === normPhone) : undefined;
}

export function buildNewClientRecord(id: string, details: ClientBookingDetails): ClientRecord {
  return {
    id,
    name: details.name,
    email: details.email,
    phone: details.phone,
    tags: ["new"],
    lastVisit: null,
    upcoming: [],
    history: [],
    notes: "",
  };
}

/**
 * A stranger booking online can only ever produce a NORMAL-visibility,
 * MAIN-bucket, PENDING appointment — never private/owner-only (§ default
 * appointment status: internal=CONFIRMED, public booking=PENDING).
 */
export function buildPublicAppointment(params: {
  id: string;
  service: ServiceDefinition;
  slot: AvailableSlot;
  date: string;
  time: string;
  client: ClientRecord;
  notes: string;
}): Appointment {
  const { id, service, slot, date, time, client, notes } = params;
  return {
    id,
    client: client.name,
    clientId: client.id,
    service: service.name,
    serviceId: service.id,
    staff: slot.staffName,
    staffId: slot.staffId,
    resourceId: slot.resourceId,
    date,
    time,
    durationMinutes: service.durationMinutes,
    price: service.price,
    currency: service.currency,
    notes,
    visibility: "normal",
    financialBucket: "main",
    status: "pending",
    paid: false,
    seriesId: null,
    recurrence: null,
  };
}

export function buildPublicBookingResult(appointment: Appointment): PublicBookingResult {
  return {
    appointmentId: appointment.id,
    serviceId: appointment.serviceId ?? "",
    serviceName: appointment.service,
    staffId: appointment.staffId ?? "",
    staffName: appointment.staff,
    date: appointment.date,
    time: appointment.time,
    status: appointment.status,
  };
}

export function buildPublicBookingAuditSummary(appointment: Appointment): string {
  return `Public booking: ${appointment.client} · ${appointment.service} · ${appointment.date} ${appointment.time}`;
}
