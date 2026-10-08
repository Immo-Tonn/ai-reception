import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AvailableSlot } from "@/features/appointments/availability";
import { pickSlot } from "@/features/appointments/availability";
import type { ClientActionErrorCode, MyBooking, MyBookingStatus } from "@/features/clientAccount/types";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { instantToWall, isValidTimeZone, wallToInstant } from "@/lib/time/zonedTime";
import {
  PublicBookingError,
  computeSlots,
  enforce,
  loadPublicCatalog,
  type PublicBookingDeps,
} from "@/server/booking/publicBooking.service";

/**
 * Client Account application service (migration 0018). Runs with the service
 * role, but ONLY through the 0018 functions, and ONLY with a `userId` that the
 * caller took from the server-verified session — never from the browser.
 * Bookings are looked up by the claim relationship, never by e-mail.
 * Errors leave as stable CODES (the database text is dropped here).
 */
export class ClientAccountError extends Error {
  constructor(public code: Exclude<ClientActionErrorCode, "unauthenticated" | "unavailable">, public retryAfterSeconds = 0) {
    super(code);
    this.name = "ClientAccountError";
  }
}

export type ClientAccountDeps = Pick<PublicBookingDeps, "admin" | "rateLimiter" | "now">;

interface MyBookingRow {
  out_appointment_id: string;
  out_workspace_id: string;
  out_workspace_slug: string;
  out_workspace_name: string;
  out_timezone: string | null;
  out_starts_at: string;
  out_ends_at: string;
  out_status: string;
  out_service_id: string | null;
  out_service_name: string | null;
  out_staff_id: string | null;
  out_staff_name: string | null;
  out_resource_id: string | null;
  out_price: number | string | null;
  out_currency: string | null;
}

const uuid = z.string().uuid();
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const nowOf = (deps: Pick<ClientAccountDeps, "now">) => (deps.now ?? (() => new Date()))();

function requireUser(userId: string) {
  if (!uuid.safeParse(userId).success) throw new ClientAccountError("invalid_input");
}

/** Translates the rate limiter / availability errors of the guest engine into client codes. */
function translate(error: unknown): never {
  if (error instanceof ClientAccountError) throw error;
  if (error instanceof PublicBookingError) {
    const code = error.code === "unknown" ? "unknown" : error.code;
    throw new ClientAccountError(code, error.retryAfterSeconds);
  }
  throw new ClientAccountError("unknown");
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    return translate(error);
  }
}

export function mapBookingRow(row: MyBookingRow, now: Date): MyBooking {
  const timezone = row.out_timezone && isValidTimeZone(row.out_timezone) ? row.out_timezone : "Europe/Berlin";
  const start = instantToWall(row.out_starts_at, timezone);
  const end = instantToWall(row.out_ends_at, timezone);
  const status = row.out_status as MyBookingStatus;
  const isUpcoming = new Date(row.out_starts_at).getTime() > now.getTime();
  const canCancel = isUpcoming && (status === "pending" || status === "confirmed");
  return {
    id: row.out_appointment_id,
    workspaceSlug: row.out_workspace_slug,
    businessName: row.out_workspace_name,
    timezone,
    startsAt: new Date(row.out_starts_at).toISOString(),
    endsAt: new Date(row.out_ends_at).toISOString(),
    date: start.date,
    time: start.time,
    endTime: end.time,
    status,
    serviceId: row.out_service_id,
    serviceName: row.out_service_name,
    staffId: row.out_staff_id,
    staffName: row.out_staff_name,
    resourceId: row.out_resource_id,
    price: Number(row.out_price ?? 0),
    currency: row.out_currency ?? "EUR",
    isUpcoming,
    canCancel,
    canReschedule: canCancel && Boolean(row.out_service_id) && Boolean(row.out_staff_id),
  };
}

/** Upcoming first (soonest first), then past (most recent first). */
export function sortMyBookings(list: MyBooking[]): MyBooking[] {
  const t = (b: MyBooking) => new Date(b.startsAt).getTime();
  const upcoming = list.filter((b) => b.isUpcoming).sort((a, b) => t(a) - t(b));
  const past = list.filter((b) => !b.isUpcoming).sort((a, b) => t(b) - t(a));
  return [...upcoming, ...past];
}

export async function listMyBookings(deps: ClientAccountDeps, userId: string): Promise<MyBooking[]> {
  return guarded(async () => {
    requireUser(userId);
    const { data, error } = await deps.admin.rpc("list_my_bookings", { p_user_id: userId, p_limit: 200 });
    if (error) throw new ClientAccountError("unknown");
    const now = nowOf(deps);
    return sortMyBookings(((data as MyBookingRow[] | null) ?? []).filter((r) => !isDemoWorkspaceSlug(r.out_workspace_slug)).map((r) => mapBookingRow(r, now)));
  });
}

export async function claimBooking(deps: ClientAccountDeps, userId: string, token: string): Promise<{ appointmentId: string }> {
  return guarded(async () => {
    requireUser(userId);
    await enforce(deps, [{ scope: "client_claim_user", limit: 30, windowSeconds: 3600, subject: userId }]);
    const { data, error } = await deps.admin.rpc("claim_booking", { p_user_id: userId, p_token: token });
    if (error) {
      if (error.code === "P0002") throw new ClientAccountError("not_found");
      if (error.code === "42501") throw new ClientAccountError("not_manageable");
      throw new ClientAccountError("unknown");
    }
    const row = (Array.isArray(data) ? data[0] : data) as { out_appointment_id: string } | undefined;
    if (!row) throw new ClientAccountError("unknown");
    return { appointmentId: row.out_appointment_id };
  });
}

/** Ownership check: the booking must be in the user's OWN list. */
async function loadOwn(deps: ClientAccountDeps, userId: string, appointmentId: string): Promise<MyBooking> {
  if (!uuid.safeParse(appointmentId).success) throw new ClientAccountError("invalid_input");
  const own = (await listMyBookings(deps, userId)).find((b) => b.id === appointmentId);
  if (!own || isDemoWorkspaceSlug(own.workspaceSlug)) throw new ClientAccountError("not_found");
  return own;
}

function mapMutationError(error: { code?: string; message?: string }): never {
  if (error.code === "23P01") throw new ClientAccountError("slot_unavailable");
  if (error.code === "P0002") {
    // not_found vs service/staff/resource no longer available
    if (/not_found/.test(error.message ?? "")) throw new ClientAccountError("not_found");
    throw new ClientAccountError("slot_unavailable");
  }
  if (error.code === "22023") {
    if (/invalid_time/.test(error.message ?? "")) throw new ClientAccountError("slot_unavailable");
    throw new ClientAccountError("not_manageable");
  }
  throw new ClientAccountError("unknown");
}

export async function cancelMyBooking(deps: ClientAccountDeps, userId: string, appointmentId: string): Promise<void> {
  return guarded(async () => {
    requireUser(userId);
    await enforce(deps, [{ scope: "client_cancel_user", limit: 20, windowSeconds: 3600, subject: userId }]);
    const own = await loadOwn(deps, userId, appointmentId);
    if (!own.canCancel) throw new ClientAccountError("not_manageable");
    const { error } = await deps.admin.rpc("cancel_my_booking", { p_user_id: userId, p_appointment_id: appointmentId });
    if (error) mapMutationError(error);
  });
}

/** Loads what rescheduling needs: the own booking, the live catalog and the booking's own busy window. */
async function rescheduleContext(deps: ClientAccountDeps, userId: string, appointmentId: string) {
  const own = await loadOwn(deps, userId, appointmentId);
  if (!own.canReschedule || !own.serviceId || !own.staffId) throw new ClientAccountError("not_manageable");
  const catalog = await loadPublicCatalog(deps, own.workspaceSlug);
  if (!catalog) throw new ClientAccountError("not_manageable");
  const service = catalog.services.find((s) => s.id === own.serviceId);
  if (!service) throw new ClientAccountError("not_manageable");
  const busyFrom = new Date(new Date(own.startsAt).getTime() - service.bufferBeforeMinutes * 60_000);
  const busyUntil = new Date(new Date(own.endsAt).getTime() + service.bufferAfterMinutes * 60_000);
  return {
    own,
    catalog,
    ignore: { staffId: own.staffId, resourceId: own.resourceId, busyFrom, busyUntil },
  };
}

/** Bookable slots for moving the booking on `date`, using the SAME engine as guest booking. */
export async function getRescheduleSlots(
  deps: ClientAccountDeps,
  userId: string,
  appointmentId: string,
  date: string,
): Promise<AvailableSlot[]> {
  return guarded(async () => {
    requireUser(userId);
    if (!dateSchema.safeParse(date).success) throw new ClientAccountError("invalid_input");
    await enforce(deps, [{ scope: "client_slots_user", limit: 120, windowSeconds: 60, subject: userId }]);
    const ctx = await rescheduleContext(deps, userId, appointmentId);
    return computeSlots(deps, ctx.catalog, ctx.own.serviceId!, null, date, ctx.ignore);
  });
}

export async function rescheduleMyBooking(
  deps: ClientAccountDeps,
  userId: string,
  appointmentId: string,
  date: string,
  time: string,
  staffId: string | null,
): Promise<void> {
  return guarded(async () => {
    requireUser(userId);
    if (!dateSchema.safeParse(date).success || !timeSchema.safeParse(time).success) throw new ClientAccountError("invalid_input");
    if (staffId !== null && !uuid.safeParse(staffId).success) throw new ClientAccountError("invalid_input");
    await enforce(deps, [{ scope: "client_reschedule_user", limit: 20, windowSeconds: 3600, subject: userId }]);
    const ctx = await rescheduleContext(deps, userId, appointmentId);

    const slots = await computeSlots(deps, ctx.catalog, ctx.own.serviceId!, staffId, date, ctx.ignore);
    const slot = pickSlot(slots, time, staffId);
    if (!slot) throw new ClientAccountError("slot_unavailable");

    const { error } = await deps.admin.rpc("reschedule_my_booking", {
      p_user_id: userId,
      p_appointment_id: appointmentId,
      p_new_starts_at: wallToInstant(date, time, ctx.catalog.workspace.timezone).toISOString(),
      p_staff_id: slot.staffId,
      p_resource_id: slot.resourceId,
    });
    if (error) mapMutationError(error);
  });
}

/** Issues the secret claim token for a just-created guest booking. Returns null on any problem (best effort). */
export async function issueBookingClaim(deps: Pick<ClientAccountDeps, "admin">, appointmentId: string): Promise<string | null> {
  try {
    const { data, error } = await deps.admin.rpc("issue_booking_claim", { p_appointment_id: appointmentId });
    return error || typeof data !== "string" ? null : data;
  } catch {
    return null;
  }
}

export interface ClientAccountProfileInput {
  fullName?: string;
  phone?: string;
  locale?: string;
}

const LOCALES = ["en", "de", "uk", "ru"] as const;

/**
 * Creates the account row (idempotent). Only provided, valid fields are written, so a later
 * sign-in never wipes a profile with empty values. Best effort for the caller.
 */
export async function ensureClientAccount(deps: { admin: SupabaseClient }, userId: string, input: ClientAccountProfileInput = {}): Promise<void> {
  requireUser(userId);
  const fields: Record<string, string> = {};
  const name = input.fullName?.trim();
  if (name) fields.full_name = name.slice(0, 120);
  const phone = input.phone?.trim();
  if (phone) fields.phone = phone.slice(0, 40);
  if (input.locale && (LOCALES as readonly string[]).includes(input.locale)) fields.locale = input.locale;

  const insert = await deps.admin.from("client_accounts").insert({ user_id: userId, ...fields });
  if (!insert.error) return;
  if (insert.error.code !== "23505") throw new ClientAccountError("unknown");
  if (Object.keys(fields).length === 0) return;
  const update = await deps.admin.from("client_accounts").update({ ...fields, updated_at: new Date().toISOString() }).eq("user_id", userId);
  if (update.error) throw new ClientAccountError("unknown");
}
