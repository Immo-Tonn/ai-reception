import type { Appointment } from "./types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import { checkAvailability, resolveDay } from "@/features/workingHours/logic";
import { fromMinutes, gridStarts, SLOT_INTERVAL_DEFAULT } from "@/features/scheduling/intervals";
import { findConflicts } from "./conflicts";

export interface AvailableSlot {
  time: string;
  staffId: string;
  staffName: string;
  resourceId: string | null;
}

/**
 * `notBefore` is a Date whose LOCAL fields hold the workspace wall clock
 * (see `nowAsWallClock`). Compared as wall-clock strings/minutes so a slot
 * time never has to exist as a local Date (DST gaps on the server).
 */
function isBeforeNotBefore(date: string, minutes: number, notBefore: Date): boolean {
  const pad = (n: number) => String(n).padStart(2, "0");
  const nbDate = `${notBefore.getFullYear()}-${pad(notBefore.getMonth() + 1)}-${pad(notBefore.getDate())}`;
  if (date !== nbDate) return date < nbDate;
  return minutes * 60 < notBefore.getHours() * 3600 + notBefore.getMinutes() * 60 + notBefore.getSeconds();
}

/**
 * THE shared availability engine (§ Public Booking: "не создавать вторую
 * отдельную логику"). Pure and storage-agnostic — the Calendar's
 * conflict checks, the Public Booking slot picker, and the tests below
 * all call this same function (or the `findConflicts`/`checkAvailability`
 * it's built from). No repository/session import here on purpose, so it
 * runs in plain Node under Vitest with no Next.js/server-only shims.
 *
 * Returns one slot PER eligible staff member per time (so callers can
 * assign a specific person). UI that offers "any specialist" must collapse
 * those with `uniqueSlotTimes` and resolve the assignee with `pickSlot`.
 *
 * Extension point for External Calendar sync: busy intervals from an
 * external provider are just one more "is this staff/time taken" input —
 * add an optional `externalBusyIntervals` param here and check it next to
 * `findConflicts` inside the per-slot loop. Callers (both wrappers) would
 * supply it; BookingWizard does not change.
 */
export function computeAvailableSlots(params: {
  service: ServiceDefinition;
  eligibleStaff: StaffMember[];
  candidateResources: ResourceDefinition[];
  existingAppointments: Appointment[];
  allServices: ServiceDefinition[];
  workingHours: WorkingHoursProfile[];
  date: string;
  /**
   * Slots starting before this moment are excluded. The caller supplies it
   * (e.g. `new Date()`, or now + a lead-time) so this stays pure and
   * testable — nothing in here reads the clock. Interpreted in the same
   * (browser-local) time the rest of the engine uses for `date`/`time`.
   * Server callers pass `nowAsWallClock(now, workspaceTimeZone)`.
   */
  notBefore?: Date;
  /** Granularity of start times in minutes (booking rule, default 15). Start times lie on the clock grid; NOT the service duration. */
  slotIntervalMinutes?: number;
}): AvailableSlot[] {
  const {
    service,
    eligibleStaff,
    candidateResources,
    existingAppointments,
    allServices,
    workingHours,
    date,
    notBefore,
  } = params;

  const step = params.slotIntervalMinutes ?? SLOT_INTERVAL_DEFAULT;
  const slots: AvailableSlot[] = [];

  for (const staff of eligibleStaff) {
    if (staff.active === false) continue;
    // Effective hours (business INTERSECT staff, minus breaks / time off) of this person that day.
    const day = resolveDay(staff.id, date, workingHours, staff.name);
    // No schedule known at all (profile-less callers only; real workspaces are default-deny): a neutral daytime window.
    const intervals = day.unrestricted ? [{ start: 8 * 60, end: 20 * 60 }] : day.effective;
    for (const interval of intervals) {
      for (const minutes of gridStarts(interval, service.durationMinutes, step)) {
        if (notBefore && isBeforeNotBefore(date, minutes, notBefore)) continue;
        const time = fromMinutes(minutes);

        const check = (resourceId: string | null) =>
          checkSlotConflicts({ service, staff, resourceId, date, time, existingAppointments, allServices });

        let resourceId: string | null = null;
        if (service.requiredResourceType) {
          const freeResource = candidateResources.find((resource) => resource.active !== false && check(resource.id).available);
          if (!freeResource) continue;
          resourceId = freeResource.id;
        } else if (!check(null).available) {
          continue;
        }

        slots.push({ time, staffId: staff.id, staffName: staff.name, resourceId });
      }
    }
  }

  return slots.sort((a, b) => a.time.localeCompare(b.time));
}

export interface SlotCheck {
  available: boolean;
  reason?: "dayOff" | "outsideHours" | "onBreak" | "timeOff" | "blocked" | "staffConflict" | "resourceConflict";
}

/**
 * THE single rule for "may this person (and resource) take this wall-clock
 * time?" — working hours / breaks / time off / blocks, then staff and
 * resource collisions with service buffers. `computeAvailableSlots` (Public
 * Booking, Business slot suggestions) and the Business appointment-creation
 * check both go through it, so the two can never disagree. The database's
 * exclusion constraints (migration 0011) then back this up under concurrency.
 *
 * `ignoreAppointmentId` lets an edit/move not collide with itself.
 */
export function checkSlotAvailable(params: {
  service: Pick<ServiceDefinition, "id" | "name" | "durationMinutes">;
  staff: Pick<StaffMember, "id" | "name">;
  resourceId: string | null;
  date: string;
  time: string;
  existingAppointments: Appointment[];
  allServices: ServiceDefinition[];
  workingHours: WorkingHoursProfile[];
  ignoreAppointmentId?: string;
}): SlotCheck {
  const { service, staff, resourceId, date, time, existingAppointments, allServices, workingHours } = params;

  const hours = checkAvailability(staff.id, date, time, service.durationMinutes, workingHours, staff.name);
  if (!hours.available) return { available: false, reason: hours.reason };
  return checkSlotConflicts({ service, staff, resourceId, date, time, existingAppointments, allServices, ignoreAppointmentId: params.ignoreAppointmentId });
}

/** Collisions only (staff and resource, buffers included) — the second half of `checkSlotAvailable`. */
function checkSlotConflicts(params: {
  service: Pick<ServiceDefinition, "id" | "name" | "durationMinutes">;
  staff: Pick<StaffMember, "id" | "name">;
  resourceId: string | null;
  date: string;
  time: string;
  existingAppointments: Appointment[];
  allServices: ServiceDefinition[];
  ignoreAppointmentId?: string;
}): SlotCheck {
  const { service, staff, resourceId, date, time, existingAppointments, allServices } = params;
  const conflict = findConflicts(
    {
      id: params.ignoreAppointmentId ?? "candidate",
      staff: staff.name,
      staffId: staff.id,
      resourceId,
      date,
      time,
      durationMinutes: service.durationMinutes,
      service: service.name,
      serviceId: service.id,
    },
    existingAppointments,
    allServices,
  );
  if (conflict.staffConflict) return { available: false, reason: "staffConflict" };
  if (conflict.resourceConflict) return { available: false, reason: "resourceConflict" };
  return { available: true };
}

/**
 * Catalog-level entry point shared by every caller (browser demo adapter,
 * demo server mock, real workspaces — Public Booking and Business alike):
 * picks the eligible staff and candidate resources for a service, then runs
 * `computeAvailableSlots`.
 */
export function computeSlotsFor(params: {
  serviceId: string;
  /** `null` = any eligible specialist. */
  staffId: string | null;
  services: ServiceDefinition[];
  staff: StaffMember[];
  resources: ResourceDefinition[];
  existingAppointments: Appointment[];
  workingHours: WorkingHoursProfile[];
  date: string;
  notBefore?: Date;
  slotIntervalMinutes?: number;
}): AvailableSlot[] {
  const { serviceId, staffId, services, staff: allStaff, resources } = params;
  const service = services.find((s) => s.id === serviceId);
  if (!service) return [];
  // Archived people / resources are never offered (they stay resolvable for history elsewhere).
  const staff = allStaff.filter((s) => s.active !== false);

  const eligibleStaff = staffId
    ? staff.filter((s) => s.id === staffId && (service.allowedStaffIds.length === 0 || service.allowedStaffIds.includes(s.id)))
    : service.allowedStaffIds.length > 0
      ? staff.filter((s) => service.allowedStaffIds.includes(s.id))
      : staff;

  const candidateResources = candidateResourcesFor(service, resources);

  return computeAvailableSlots({
    service,
    eligibleStaff,
    candidateResources,
    existingAppointments: params.existingAppointments,
    allServices: services,
    workingHours: params.workingHours,
    date: params.date,
    notBefore: params.notBefore,
    slotIntervalMinutes: params.slotIntervalMinutes,
  });
}

/**
 * Resources a service may use: the ones linked to it if any link exists,
 * otherwise every resource of `requiredResourceType`. Archived ones never.
 * No required type = no resource.
 */
export function candidateResourcesFor(
  service: Pick<ServiceDefinition, "requiredResourceType" | "resourceIds">,
  resources: ResourceDefinition[],
): ResourceDefinition[] {
  if (!service.requiredResourceType) return [];
  const active = resources.filter((r) => r.active !== false);
  const linked = service.resourceIds ?? [];
  return linked.length > 0 ? active.filter((r) => linked.includes(r.id)) : active.filter((r) => r.type === service.requiredResourceType);
}

/**
 * Collapses per-staff slots to one entry per distinct time ("any
 * specialist" — the visitor sees each time once). The kept entry is the
 * first candidate for that time in input order, which is only a
 * placeholder: the real assignee is chosen by `pickSlot` at booking time.
 */
export function uniqueSlotTimes(slots: AvailableSlot[]): AvailableSlot[] {
  const seen = new Set<string>();
  const result: AvailableSlot[] = [];
  for (const slot of slots) {
    if (seen.has(slot.time)) continue;
    seen.add(slot.time);
    result.push(slot);
  }
  return result;
}

/**
 * Resolves the slot that will actually be booked for a chosen time.
 * - Specific specialist: that person's slot at that time, or `undefined`
 *   if they are no longer free.
 * - Any specialist (`staffId` null): the first free candidate at that time
 *   in the engine's staff order (deterministic; load balancing is a future
 *   policy and would change only this function).
 * Used both when showing the pick and at write time, so the assignee shown
 * is the assignee booked as long as availability has not changed.
 */
export function pickSlot(
  slots: AvailableSlot[],
  time: string,
  staffId: string | null,
): AvailableSlot | undefined {
  return slots.find((s) => s.time === time && (staffId === null || s.staffId === staffId));
}
