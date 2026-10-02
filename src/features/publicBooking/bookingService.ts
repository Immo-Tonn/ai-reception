import type { AvailableSlot } from "@/features/appointments/availability";
import type { PublicBookingRequest, PublicBookingResult } from "./bookingRules";
import { localDemoBookingService } from "./localDemoBookingService";

export type { PublicBookingRequest, PublicBookingResult };
export { BookingUnavailableError } from "./bookingRules";

/**
 * THE application boundary for Public Booking. BookingWizard (and the
 * embed, which is the same wizard) talk only to this interface:
 *
 *   BookingWizard → PublicBookingService → adapter → persistence
 *
 * Today the only adapter is `localDemoBookingService` (visitor's own
 * browser localStorage — a booking made there is NOT visible to the
 * business on another device). When the shared backend exists, add a
 * `remoteBookingService` implementing this interface (HTTP/Supabase) and
 * return it from `getPublicBookingService()`; no UI changes.
 */
export interface PublicBookingService {
  /**
   * Bookable slots, one per eligible specialist per time (callers collapse
   * with `uniqueSlotTimes`). Already excludes times in the past.
   */
  getAvailableSlots(
    workspaceSlug: string,
    serviceId: string,
    staffId: string | null,
    date: string,
  ): Promise<AvailableSlot[]>;

  /**
   * Re-validates availability at write time and creates the booking.
   * Throws `BookingUnavailableError` if the time is gone.
   */
  createBooking(workspaceSlug: string, request: PublicBookingRequest): Promise<PublicBookingResult>;
}

export function getPublicBookingService(): PublicBookingService {
  return localDemoBookingService;
}
