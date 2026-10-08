import type { AvailableSlot } from "@/features/appointments/availability";
import type { PublicBookingRequest, PublicBookingResult } from "./bookingRules";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { localDemoBookingService } from "./localDemoBookingService";
import { remotePublicBookingService } from "./remotePublicBookingService";

export type { PublicBookingRequest, PublicBookingResult };
export { BookingUnavailableError, BookingRateLimitedError } from "./bookingRules";

/**
 * THE application boundary for Public Booking. BookingWizard (and the
 * embed, which is the same wizard) talk only to this interface:
 *
 *   BookingWizard → PublicBookingService → adapter → persistence
 *
 * Two adapters behind this one interface: `localDemoBookingService` (demo
 * workspaces, the visitor's own browser) and `remotePublicBookingService`
 * (real workspaces, shared Supabase backend via Server Actions). The UI does
 * not know which one it is talking to.
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
   * Days in [fromDate, fromDate + days) that really have at least one slot
   * (same engine as `getAvailableSlots`). `null` = could not be determined.
   */
  getAvailableDates(
    workspaceSlug: string,
    serviceId: string,
    staffId: string | null,
    fromDate: string,
    days: number,
  ): Promise<string[] | null>;

  /**
   * Re-validates availability at write time and creates the booking.
   * Throws `BookingUnavailableError` if the time is gone.
   */
  createBooking(workspaceSlug: string, request: PublicBookingRequest): Promise<PublicBookingResult>;
}

/**
 * Demo workspaces keep the browser-local adapter (works with no backend at
 * all). A real workspace books through the SHARED backend: Server Actions ->
 * `PublicBookingService` (server) -> Supabase — the guest's booking lands in
 * the same database the business Calendar reads.
 */
export function getPublicBookingService(workspaceSlug: string): PublicBookingService {
  return isDemoWorkspaceSlug(workspaceSlug) ? localDemoBookingService : remotePublicBookingService;
}
