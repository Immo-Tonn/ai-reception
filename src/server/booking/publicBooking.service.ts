import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { computeSlotsFor, pickSlot, type AvailableSlot } from "@/features/appointments/availability";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition, ResourceType } from "@/features/resources/types";
import { statusFromDb } from "@/server/repository/appointmentsMapper";
import type { PublicBookingResult } from "@/features/publicBooking/bookingRules";
import { addDays, instantToWall, isValidTimeZone, nowAsWallClock, wallToInstant } from "@/lib/time/zonedTime";
import { defaultBookingRules, slotIntervalOptions, type BookingRules, type ScheduleMode } from "@/features/scheduling/types";
import { isWithinHorizon } from "@/features/scheduling/intervals";
import { computeAvailableDates } from "@/features/scheduling/availableDates";
import type { RateLimiter } from "@/server/ratelimit/rateLimiter";
import { busyRangesToAppointments, type BusyRange } from "./busyMapper";
import { workingHoursFromRows, type TimeOffRow, type WorkingHoursRow } from "./workingHoursMapper";

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

/** The customer-facing business profile: exactly what the owner entered for customers, nothing internal. */
export interface PublicProfile {
  description: string;
  phone: string;
  email: string;
  website: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface PublicCatalog {
  workspace: { id: string; slug: string; name: string; timezone: string; autoConfirm: boolean };
  profile: PublicProfile;
  services: ServiceDefinition[];
  staff: StaffMember[];
  resources: ResourceDefinition[];
  workingHours: WorkingHoursRow[];
  /** Time off / closures (private reasons never arrive here). Empty when the database predates migration 0019. */
  timeOff: TimeOffRow[];
  /** Per staff id: "inherit" (business hours) or "custom" (own hours). */
  staffModes: Record<string, ScheduleMode>;
  /** Public booking rules; defaults when absent. */
  rules: BookingRules;
}

/** Largest window one availability-dates call may cover. */
export const MAX_DATES_WINDOW = 120;

const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);
const uuid = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const publicDatesQuerySchema = z.object({
  slug: slugSchema,
  serviceId: uuid,
  staffId: uuid.nullable(),
  fromDate: dateSchema,
  days: z.number().int().min(1).max(MAX_DATES_WINDOW),
});

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
  profile?: Partial<PublicProfile> | null;
  services: (Omit<ServiceDefinition, "requiredResourceType"> & { requiredResourceType: string | null; price: number | string })[];
  staff: { id: string; name: string; title?: string | null }[];
  resources: { id: string; name: string; type: string }[];
  workingHours: { staffId: string | null; weekday: number; start: string | null; end: string | null; isDayOff: boolean }[];
  // Added by migration 0019; absent on databases that do not have it yet.
  rules?: Partial<Record<keyof BookingRules, unknown>> | null;
  timeOff?: { staffId: string | null; startDate: string; endDate: string; startTime?: string | null; endTime?: string | null }[] | null;
  staffModes?: { staffId: string; mode: string }[] | null;
}

const intIn = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** Defensive parse of the public rules: anything missing/out of range falls back to the defaults. */
export function parseBookingRules(raw: RawCatalog["rules"] | undefined, autoConfirm: boolean): BookingRules {
  const interval = Number(raw?.slotIntervalMinutes);
  return {
    ...defaultBookingRules,
    autoConfirm,
    minNoticeMinutes: intIn(raw?.minNoticeMinutes, 0, 60 * 24 * 30, defaultBookingRules.minNoticeMinutes),
    maxHorizonDays: intIn(raw?.maxHorizonDays, 1, 180, defaultBookingRules.maxHorizonDays),
    slotIntervalMinutes: (slotIntervalOptions as readonly number[]).includes(interval) ? interval : defaultBookingRules.slotIntervalMinutes,
  };
}

/** Raw RPC payload -> catalog (pure; tolerant of a pre-0019 payload). */
export function normalizePublicCatalog(raw: RawCatalog): PublicCatalog {
  const timezone = isValidTimeZone(raw.workspace.timezone) ? raw.workspace.timezone : "Europe/Berlin";
  const staffModes: Record<string, ScheduleMode> = {};
  for (const m of raw.staffModes ?? []) {
    if (m && typeof m.staffId === "string" && (m.mode === "inherit" || m.mode === "custom")) staffModes[m.staffId] = m.mode;
  }
  return {
    workspace: { ...raw.workspace, timezone },
    rules: parseBookingRules(raw.rules, Boolean(raw.workspace.autoConfirm)),
    // Allow-list copy: whatever else the database might return never reaches the page.
    profile: {
      description: raw.profile?.description ?? "",
      phone: raw.profile?.phone ?? "",
      email: raw.profile?.email ?? "",
      website: raw.profile?.website ?? "",
      addressLine1: raw.profile?.addressLine1 ?? "",
      postalCode: raw.profile?.postalCode ?? "",
      city: raw.profile?.city ?? "",
      country: raw.profile?.country ?? "",
    },
    services: raw.services.map((s) => ({
      ...s,
      price: Number(s.price),
      translations: undefined,
      requiredResourceType: (s.requiredResourceType as ResourceType | null) ?? null,
      resourceIds: Array.isArray((s as { resourceIds?: unknown }).resourceIds) ? ((s as { resourceIds: string[] }).resourceIds) : [],
    })) as unknown as ServiceDefinition[],
    staff: raw.staff.map((p) => ({
      id: p.id,
      name: p.name,
      colorToken: "--color-accent-blue",
      ...(p.title ? { title: p.title } : {}),
      ...(staffModes[p.id] ? { scheduleMode: staffModes[p.id] } : {}),
    })),
    resources: raw.resources.map((r) => ({ id: r.id, name: r.name, type: r.type as ResourceType })),
    workingHours: raw.workingHours.map((h) => ({
      staff_id: h.staffId,
      weekday: h.weekday,
      start_time: h.start,
      end_time: h.end,
      is_day_off: h.isDayOff,
    })),
    timeOff: (raw.timeOff ?? []).map((t) => ({
      staff_id: t.staffId ?? null,
      start_date: t.startDate,
      end_date: t.endDate,
      start_time: t.startTime ?? null,
      end_time: t.endTime ?? null,
    })),
    staffModes,
  };
}

export async function loadPublicCatalog(deps: Pick<PublicBookingDeps, "admin">, slug: string): Promise<PublicCatalog | null> {
  if (!slugSchema.safeParse(slug).success) return null;
  const { data, error } = await deps.admin.rpc("get_public_booking_catalog", { p_slug: slug });
  if (error) throw new PublicBookingError("unknown");
  const raw = data as RawCatalog | null;
  if (!raw) return null;
  return normalizePublicCatalog(raw);
}

/**
 * An occupied window (buffers included, exactly as the database stores
 * `busy_from` / `busy_until`) that availability must NOT count: the booking
 * being moved must not block its own new time.
 */
export interface IgnoredBusyWindow {
  staffId: string | null;
  resourceId: string | null;
  busyFrom: Date;
  busyUntil: Date;
}

/** Occupied time in [fromDate - 1 day, toDate + 2 days) (so buffers / day edges are covered), as engine appointments. */
async function loadBusyAppointments(
  deps: Pick<PublicBookingDeps, "admin">,
  catalog: PublicCatalog,
  fromDate: string,
  toDate: string,
  ignore?: IgnoredBusyWindow,
) {
  const tz = catalog.workspace.timezone;
  const from = wallToInstant(addDays(fromDate, -1), "00:00", tz).toISOString();
  const to = wallToInstant(addDays(toDate, 2), "00:00", tz).toISOString();
  const { data, error } = await deps.admin.rpc("get_public_busy", { p_workspace_id: catalog.workspace.id, p_from: from, p_to: to });
  if (error) throw new PublicBookingError("unknown");

  let busy = (data as BusyRange[]) ?? [];
  if (ignore) {
    // get_public_busy returns no ids: drop exactly ONE row equal to the booking's own window.
    const i = busy.findIndex(
      (r) =>
        r.staff_id === ignore.staffId &&
        (r.resource_id ?? null) === ignore.resourceId &&
        new Date(r.busy_from).getTime() === ignore.busyFrom.getTime() &&
        new Date(r.busy_until).getTime() === ignore.busyUntil.getTime(),
    );
    if (i >= 0) busy = busy.filter((_, j) => j !== i);
  }
  return busyRangesToAppointments(busy, tz, catalog.staff);
}

/** The engine inputs shared by slots and dates: the catalog's rules, in the workspace time zone. */
function engineContext(catalog: PublicCatalog, now: Date) {
  const tz = catalog.workspace.timezone;
  const { minNoticeMinutes, maxHorizonDays, slotIntervalMinutes } = catalog.rules;
  return {
    today: instantToWall(now, tz).date,
    maxHorizonDays,
    slotIntervalMinutes,
    // "now + minimum notice" as a wall clock of the workspace (instant arithmetic, so DST-safe).
    notBefore: nowAsWallClock(new Date(now.getTime() + minNoticeMinutes * 60_000), tz),
    workingHours: workingHoursFromRows(catalog.workingHours, catalog.timeOff, catalog.staffModes),
  };
}

function assertServiceAndStaff(catalog: PublicCatalog, serviceId: string, staffId: string | null) {
  if (!catalog.services.some((s) => s.id === serviceId)) throw new PublicBookingError("invalid_input");
  if (staffId && !catalog.staff.some((s) => s.id === staffId)) throw new PublicBookingError("invalid_input");
}

export async function computeSlots(
  deps: Pick<PublicBookingDeps, "admin" | "now">,
  catalog: PublicCatalog,
  serviceId: string,
  staffId: string | null,
  date: string,
  ignore?: IgnoredBusyWindow,
): Promise<AvailableSlot[]> {
  const now = (deps.now ?? (() => new Date()))();
  const ctx = engineContext(catalog, now);
  if (!isWithinHorizon(date, ctx.today, ctx.maxHorizonDays)) return [];
  assertServiceAndStaff(catalog, serviceId, staffId);

  return computeSlotsFor({
    serviceId,
    staffId,
    services: catalog.services,
    staff: catalog.staff,
    resources: catalog.resources,
    existingAppointments: await loadBusyAppointments(deps, catalog, date, date, ignore),
    workingHours: ctx.workingHours,
    date,
    notBefore: ctx.notBefore,
    slotIntervalMinutes: ctx.slotIntervalMinutes,
  });
}

/**
 * Days in [fromDate, fromDate + days) that really have a bookable slot — ONE busy
 * fetch, then the same engine per day (pure), horizon and min notice applied.
 */
export async function computeAvailableDatesForCatalog(
  deps: Pick<PublicBookingDeps, "admin" | "now">,
  catalog: PublicCatalog,
  serviceId: string,
  staffId: string | null,
  fromDate: string,
  days: number,
): Promise<string[]> {
  const now = (deps.now ?? (() => new Date()))();
  const ctx = engineContext(catalog, now);
  assertServiceAndStaff(catalog, serviceId, staffId);
  const window = Math.min(Math.max(1, days), MAX_DATES_WINDOW);
  return computeAvailableDates({
    serviceId,
    staffId,
    services: catalog.services,
    staff: catalog.staff,
    resources: catalog.resources,
    existingAppointments: await loadBusyAppointments(deps, catalog, fromDate, addDays(fromDate, window - 1)),
    workingHours: ctx.workingHours,
    fromDate,
    days: window,
    today: ctx.today,
    maxHorizonDays: ctx.maxHorizonDays,
    notBefore: ctx.notBefore,
    slotIntervalMinutes: ctx.slotIntervalMinutes,
  });
}

export async function enforce(deps: Pick<PublicBookingDeps, "rateLimiter">, rules: { scope: string; limit: number; windowSeconds: number; subject: string }[]) {
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

/** Days with at least one bookable slot (see `computeAvailableDatesForCatalog`); rate limited like slots. */
export async function getPublicAvailableDates(deps: PublicBookingDeps, ctx: { ip: string }, input: unknown): Promise<string[]> {
  const parsed = publicDatesQuerySchema.safeParse(input);
  if (!parsed.success) throw new PublicBookingError("invalid_input");
  const { slug, serviceId, staffId, fromDate, days } = parsed.data;

  await enforce(deps, [{ scope: "public_dates_ip", limit: 60, windowSeconds: 60, subject: ctx.ip }]);

  const catalog = await loadPublicCatalog(deps, slug);
  if (!catalog) throw new PublicBookingError("not_found");
  return computeAvailableDatesForCatalog(deps, catalog, serviceId, staffId, fromDate, days);
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
