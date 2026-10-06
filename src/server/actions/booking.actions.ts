"use server";

import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getServerServicesRepository, getServerStaffRepository } from "@/server/repository/registry";
import { findWorkspaceBySlug } from "@/server/repository/supabase/workspaceInfo";
import { getAvailableDates, getAvailableSlots } from "@/server/services/availability.service";
import { BookingUnavailableError, createPublicBooking } from "@/server/services/publicBooking.service";
import { allow, clientIp } from "@/server/security/rateLimit";
import { publicBookingSchema, type PublicBookingInput } from "@/server/validation/availability.schema";

/**
 * Public Booking contract — no session, callable from an unauthenticated
 * visitor on the standalone page or an embedded iframe on someone else's
 * site (§2/§3). Every write still runs through the same validate →
 * business-rules → repository → audit pipeline as the authenticated
 * flow; `publicBooking.service.ts` just fixes the session-shaped
 * decisions (visibility, bucket) instead of trusting the caller.
 *
 * Every action takes the public workspace *slug* (what's in the booking
 * URL) and resolves it to the real workspace here — a visitor never sees
 * or supplies an internal id.
 */

class WorkspaceNotFoundError extends Error {
  constructor() {
    super("This booking page does not exist.");
    this.name = "WorkspaceNotFoundError";
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

async function resolveWorkspaceId(workspaceSlug: string): Promise<string> {
  if (!SLUG_RE.test(workspaceSlug)) throw new WorkspaceNotFoundError();
  // The four demo presets are keyed by slug itself; real workspaces by UUID.
  if (isDemoWorkspaceSlug(workspaceSlug)) return workspaceSlug;
  const workspace = await findWorkspaceBySlug(workspaceSlug);
  if (!workspace) throw new WorkspaceNotFoundError();
  return workspace.id;
}

/** Public booking page header data for a real workspace (null = unknown slug). */
export async function getBookingPageInfoAction(workspaceSlug: string) {
  if (!SLUG_RE.test(workspaceSlug) || isDemoWorkspaceSlug(workspaceSlug)) return null;
  const workspace = await findWorkspaceBySlug(workspaceSlug);
  return workspace ? { name: workspace.name } : null;
}

export async function listBookableServicesAction(workspaceSlug: string) {
  const workspaceId = await resolveWorkspaceId(workspaceSlug);
  return getServerServicesRepository(workspaceId).list();
}

export async function listBookableStaffAction(workspaceSlug: string) {
  const workspaceId = await resolveWorkspaceId(workspaceSlug);
  return getServerStaffRepository(workspaceId).list();
}

export async function getAvailabilityAction(
  workspaceSlug: string,
  serviceId: string,
  staffId: string | null,
  date: string,
) {
  const workspaceId = await resolveWorkspaceId(workspaceSlug);
  return getAvailableSlots(workspaceId, serviceId, staffId, date);
}

/** Which dates in the next `days` days have at least one free time. */
export async function getAvailableDatesAction(
  workspaceSlug: string,
  serviceId: string,
  staffId: string | null,
  fromDate: string,
  days: number,
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return [];
  const workspaceId = await resolveWorkspaceId(workspaceSlug);
  return getAvailableDates(workspaceId, serviceId, staffId, fromDate, days);
}

export type PublicBookingResult =
  | { ok: true }
  | { ok: false; error: "unavailable" | "invalid" | "rate_limited" | "generic" };

export async function createPublicBookingAction(
  workspaceSlug: string,
  input: PublicBookingInput,
): Promise<PublicBookingResult> {
  const parsed = publicBookingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  // Anonymous endpoint: at most 8 booking attempts per visitor per hour per page.
  if (!allow(`booking:${workspaceSlug}:${await clientIp()}`, 8, 60 * 60 * 1000)) {
    return { ok: false, error: "rate_limited" };
  }
  try {
    const workspaceId = await resolveWorkspaceId(workspaceSlug);
    await createPublicBooking(workspaceId, parsed.data);
    return { ok: true };
  } catch (error) {
    if (error instanceof BookingUnavailableError) return { ok: false, error: "unavailable" };
    console.error("[booking.actions] createPublicBooking failed", error);
    return { ok: false, error: "generic" };
  }
}
