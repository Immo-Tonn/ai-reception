"use server";

import { getServerServicesRepository, getServerStaffRepository } from "@/server/repository/registry";
import { getAvailableSlots } from "@/server/services/availability.service";
import { createPublicBooking } from "@/server/services/publicBooking.service";
import { publicBookingSchema, type PublicBookingInput } from "@/server/validation/availability.schema";

/**
 * Public Booking contract — no session, callable from an unauthenticated
 * visitor on the standalone page or an embedded iframe on someone else's
 * site (§2/§3). Every write still runs through the same validate →
 * business-rules → repository → audit pipeline as the authenticated
 * flow; `publicBooking.service.ts` just fixes the session-shaped
 * decisions (visibility, bucket) instead of trusting the caller.
 */

export async function listBookableServicesAction(workspaceId: string) {
  return getServerServicesRepository(workspaceId).list();
}

export async function listBookableStaffAction(workspaceId: string) {
  return getServerStaffRepository(workspaceId).list();
}

export async function getAvailabilityAction(
  workspaceId: string,
  serviceId: string,
  staffId: string | null,
  date: string,
) {
  return getAvailableSlots(workspaceId, serviceId, staffId, date);
}

export async function createPublicBookingAction(workspaceId: string, input: PublicBookingInput) {
  const parsed = publicBookingSchema.parse(input);
  return createPublicBooking(workspaceId, parsed);
}
