import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { computeSlotsFor, pickSlot, type AvailableSlot } from "@/features/appointments/availability";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition, ResourceType } from "@/features/resources/types";
import { statusFromDb } from "@/server/repository/appointmentsMapper";
import type { PublicBookingResult } from "@/features/publicBooking/bookingRules";
import { addDays, instantToWall, isValidTimeZone, nowAsWallClock, wallToInstant } from "@/lib/time/zonedTime";
import type { RateLimiter } from "@/server/ratelimit/rateLimiter";
import { busyRangesToAppointments, type BusyRange } from "./busyMapper";
import { workingHoursFromRows, type WorkingHoursRow } from "./workingHoursMapper";

/**
 * The real (shared-backend) Public Booking application service. A guest has
 * no account, so this runs with the service role — but ONLY through the three
 * database functions of migration 0013 (catalog, busy ranges, create). The
 * guest never gets a table, a query builder or an id they did not first read
 * from the catalog. Nothing here trusts the browser:
 *   - workspace comes from the slug and is re-read from the database;
 *   - service / staff / resource must belong to that workspace;
 *   - availability is recomputed server-side with the SAME engine the Business
 *     app uses (`computeSlotsFor`), in the business's time zone, excluding
 *     the past;
 *   - price, duration, status, visibility and financial account are decided
 *     by the database function;
 *   - a collision is refused by the exclusion constraints — that, not the
 *     read above, is what makes simultaneous requests safe.
 */

export type PublicBookingErrorCode = "not_found" | "invalid_input" | "slot_unavailable" | "rate_limited" | "unknown";

export class PublicBookingError extends Error {
  constructor(public code: PublicBookingErrorCode, public retryAfterSeconds = 0) {
    super(code);
    this.name = "PublicBookingError";
  }
}

export interface PublicBookingDeps {
  /** Service-role client; used ONLY for the 0013 functions. */
  admin: SupabaseClient;
  rateLimiter: RateLimiter;
  now?: () => Date;
}

export interface PublicCatalog {
  workspace: { id: string; slug: string; name: string; timezone: string; autoConfirm: boolean };
  services: ServiceDefinition[];
  staff: StaffMember[];
  resources: ResourceDefinition[];
  workingHours: WorkingHoursRow[];
}

const MAX_DAYS_AHEAD = 90;

const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);
const uuid = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const publicSlotsQuerySchema = z.object({
  slug: slugSchema,
  serviceId: uuid,
  staffId: uuid.nullable(),
  date: dateSchema,
});

export const publicBookingRequestSchema = z.object({
  slug: slugSchema,
  serviceId: uuid,
  staffId: uuid.nullable(),
  date: dateSchema,
  time: timeSchema,
  client: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().min(5).max(40).regex(/^[0-9+()\-.\s]+$/),
    notes: z.string().trim().max(1000).default(""),
  }),
});

export type PublicBookingRequestInput = z.input<typeof publicBookingRequestSchema>;

interface RawCatalog {
  workspace: PublicCatalog["workspace"];
  services: (Omit<ServiceDefinition, "requiredResourceType"> & { requiredResourceType: string | null; price: number | string })[];
  staff: { id: string; name: string }[];
  resources: { id: string; name: string; type: string }[];
  workingHours: { staffId: string | null; weekday: number; start: string | null; end: string | null; isDayOff: boolean }[];
}

export async function loadPublicCatalog(deps: Pick<PublicBookingDeps, "admin">, slug: string): Promise<PublicCatalog | null> {
  if (!slugSchema.safeParse(slug).success) return null;
  const { data, error } = await deps.admin.rpc("get_public_booking_catalog", { p_slug: slug });
  if (error) throw new PublicBookingError("unknown");
  const raw = data as RawCatalog | null;
  if (!raw) return null;
  const timezone = isValidTimeZone(raw.workspace.timezone) ? raw.workspace.timezone : "Europe/Berlin";
  return {
    workspace: { ...raw.workspace, timezone },
    services: raw.services.map((s) => ({
      ...s,
      price: Number(s.price),
      translations: undefined,
      requiredResourceType: (s.requiredResourceType as ResourceType | null) ?? null,
    })) as unknown as ServiceDefinition[],
    staff: raw.staff.map((p) => ({ id: p.id, name: p.name, colorToken: "--color-accent-blue" })),
    resources: raw.resources.map((r) => ({ id: r.id, name: r.name, type: r.type as ResourceType })),
    workingHours: raw.workingHours.map((h) => ({
      staff_id: h.staffId,
      weekday: h.weekday,
      start_time: h.start,
      end_time: h.end,
      is_day_off: h.isDayOff,
    })),
  };
}

async function computeSlots(
  deps: PublicBookingDeps,
  catalog: PublicCatalog,
  serviceId: string,
  staffId: string | null,
  date: string,
): Promise<AvailableSlot[]> {
  const now = (deps.now ?? (() => new Date()))();
  const tz = catalog.workspace.timezone;
  const today = instantToWall(now, tz).date;
  if (date < today || date > addDays(today, MAX_DAYS_AHEAD)) return [];

  const service = catalog.services.find((s) => s.id === serviceId);
  if (!service) throw new PublicBookingError("invalid_input");
  if (staffId && !catalog.staff.some((s) => s.id === staffId)) throw new PublicBookingError("invalid_input");

  // Occupied time for the day (± a day, so buffers/day edges are covered).
  const from = wallToInstant(addDays(date, -1), "00:00", tz).toISOString();
  const to = wallToInstant(addDays(date, 2), "00:00", tz).toISOString();
  const { data, error } = await deps.admin.rpc("get_public_busy", { p_workspace_id: catalog.workspace.id, p_from: from, p_to: to });
  if (error) throw new PublicBookingError("unknown");

  return computeSlotsFor({
    serviceId,
    staffId,
    services: catalog.services,
    staff: catalog.staff,
    resources: catalog.resources,
    existingAppointments: busyRangesToAppointments((data as BusyRange[]) ?? [], tz, catalog.staff),
    workingHours: workingHoursFromRows(catalog.workingHours),
    date,
    notBefore: nowAsWallClock(now, tz),
  });
}

async function enforce(deps: PublicBookingDeps, rules: { scope: string; limit: number; windowSeconds: number; subject: string }[]) {
  for (const { subject, ...rule } of rules) {
    const decision = await deps.rateLimiter.hit(rule, subject);
    if (!decision.allowed) throw new PublicBookingError("rate_limited", decision.retryAfterSeconds);
  }
}

/** Bookable slots (one per eligible person per time; callers collapse with `uniqueSlotTimes`). */
export async function getPublicSlots(deps: PublicBookingDeps, ctx: { ip: string }, input: unknown): Promise<AvailableSlot[]> {
  const parsed = publicSlotsQuerySchema.safeParse(input);
  if (!parsed.success) throw new PublicBookingError("invalid_input");
  const { slug, serviceId, staffId, date } = parsed.data;

  await enforce(deps, [{ scope: "public_slots_ip", limit: 120, windowSeconds: 60, subject: ctx.ip }]);

  const catalog = await loadPublicCatalog(deps, slug);
  if (!catalog) throw new PublicBookingError("not_found");
  return computeSlots(deps, catalog, serviceId, staffId, date);
}

export async function createPublicBooking(deps: PublicBookingDeps, ctx: { ip: string }, input: unknown): Promise<PublicBookingResult> {
  const parsed = publicBookingRequestSchema.safeParse(input);
  if (!parsed.success) throw new PublicBookingError("invalid_input");
  const { slug, serviceId, staffId, date, time, client } = parsed.data;

  await enforce(deps, [
    { scope: "public_booking_ip", limit: 10, windowSeconds: 3600, subject: ctx.ip },
    { scope: "public_booking_email", limit: 5, windowSeconds: 3600, subject: `${slug}:${client.email}` },
    { scope: "public_booking_phone", limit: 5, windowSeconds: 3600, subject: `${slug}:${client.phone.replace(/[^\d+]/g, "")}` },
  ]);

  const catalog = await loadPublicCatalog(deps, slug);
  if (!catalog) throw new PublicBookingError("not_found");

  // Re-validate against the live schedule, then let the database be the final judge.
  const slots = await computeSlots(deps, catalog, serviceId, staffId, date);
  const slot = pickSlot(slots, time, staffId);
  if (!slot) throw new PublicBookingError("slot_unavailable");

  const { data, error } = await deps.admin.rpc("create_public_booking", {
    p_workspace_id: catalog.workspace.id,
    p_service_id: serviceId,
    p_staff_id: slot.staffId,
    p_resource_id: slot.resourceId,
    p_starts_at: wallToInstant(date, time, catalog.workspace.timezone).toISOString(),
    p_name: client.name,
    p_email: client.email,
    p_phone: client.phone,
    p_notes: client.notes,
  });

  if (error) {
    // 23P01 = the database refused an overlapping booking (someone else won the race).
    if (error.code === "23P01") throw new PublicBookingError("slot_unavailable");
    if (error.code === "P0002" || error.code === "22023") throw new PublicBookingError("slot_unavailable");
    throw new PublicBookingError("unknown");
  }
  const row = (Array.isArray(data) ? data[0] : data) as { out_appointment_id: string; out_status: string } | undefined;
  if (!row) throw new PublicBookingError("unknown");

  const service = catalog.services.find((s) => s.id === serviceId)!;
  return {
    appointmentId: row.out_appointment_id,
    serviceId,
    serviceName: service.name,
    staffId: slot.staffId,
    staffName: slot.staffName,
    date,
    time,
    status: statusFromDb(row.out_status),
  };
}
