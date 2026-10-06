import "server-only";
import {
  getServerAppointmentsRepository,
  getServerServicesRepository,
  getServerStaffRepository,
  getServerResourcesRepository,
} from "@/server/repository/registry";
import { computeAvailableSlots, type AvailableSlot } from "@/features/appointments/availability";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getServerWorkingHours } from "@/server/repository/workingHours";
import { getWorkspaceInfo } from "@/server/repository/supabase/workspaceInfo";
import { utcToZonedParts, zonedDateTimeToUtc } from "@/lib/date/zoned";

export type { AvailableSlot };

/** Online bookings need a little notice and have a horizon (real workspaces). */
export const MIN_LEAD_MINUTES = 30;
export const MAX_HORIZON_DAYS = 90;

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

async function loadContext(workspaceId: string, serviceId: string, staffId: string | null) {
  const [services, staffList, appointments, resources, workingHours] = await Promise.all([
    getServerServicesRepository(workspaceId).list(),
    getServerStaffRepository(workspaceId).list(),
    getServerAppointmentsRepository(workspaceId).list(),
    getServerResourcesRepository(workspaceId).list(),
    getServerWorkingHours(workspaceId),
  ]);

  const service = services.find((s) => s.id === serviceId);
  if (!service) return null;

  const eligibleStaff = staffId
    ? staffList.filter((s) => s.id === staffId)
    : service.allowedStaffIds.length > 0
      ? staffList.filter((s) => service.allowedStaffIds.includes(s.id))
      : staffList;

  const candidateResources = service.requiredResourceType
    ? resources.filter((r) => r.type === service.requiredResourceType)
    : [];

  const timezone = isDemoWorkspaceSlug(workspaceId) ? null : (await getWorkspaceInfo(workspaceId)).timezone;

  return { service, services, eligibleStaff, candidateResources, appointments, workingHours, timezone };
}

type Context = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

function slotsForDate(context: Context, date: string, now: Date): AvailableSlot[] {
  const { timezone } = context;

  if (timezone) {
    const today = utcToZonedParts(now, timezone).date;
    if (date < today || date > addDays(today, MAX_HORIZON_DAYS)) return [];
  }

  const slots = computeAvailableSlots({
    service: context.service,
    eligibleStaff: context.eligibleStaff,
    candidateResources: context.candidateResources,
    existingAppointments: context.appointments,
    allServices: context.services,
    workingHours: context.workingHours,
    date,
  });

  if (!timezone) return slots;
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  return slots.filter((slot) => zonedDateTimeToUtc(date, slot.time, timezone).getTime() >= earliest);
}

/**
 * Thin repository-fetching wrapper around the shared, pure
 * `computeAvailableSlots` engine (features/appointments/availability.ts)
 * — used by both the authenticated Calendar's conflict preview and
 * Public Booking's slot picker. All the actual logic lives in the pure
 * function so it can be unit-tested without a server context. For real
 * workspaces, times in the past (business time zone) and beyond the
 * booking horizon are never offered.
 */
export async function getAvailableSlots(
  workspaceId: string,
  serviceId: string,
  staffId: string | null,
  date: string,
): Promise<AvailableSlot[]> {
  const context = await loadContext(workspaceId, serviceId, staffId);
  if (!context) return [];
  return slotsForDate(context, date, new Date());
}

/** Dates in [fromDate, fromDate + days) that have at least one free slot. */
export async function getAvailableDates(
  workspaceId: string,
  serviceId: string,
  staffId: string | null,
  fromDate: string,
  days: number,
): Promise<string[]> {
  const context = await loadContext(workspaceId, serviceId, staffId);
  if (!context) return [];
  const now = new Date();
  const count = Math.min(Math.max(days, 1), 62);
  const result: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const date = addDays(fromDate, i);
    if (slotsForDate(context, date, now).length > 0) result.push(date);
  }
  return result;
}
