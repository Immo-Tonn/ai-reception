import type { AvailableSlot } from "@/features/appointments/availability";
import { createPublicBookingAction, getPublicSlotsAction } from "@/server/actions/publicBooking.actions";
import type { PublicBookingService } from "./bookingService";
import { BookingRateLimitedError, BookingUnavailableError } from "./bookingRules";

/**
 * Real-workspace adapter of `PublicBookingService`: Server Actions only. The
 * browser never talks to the database, never sees an id it was not given by
 * the server's catalog, and never decides price/status/visibility — the
 * server (and the database) do.
 */
export const remotePublicBookingService: PublicBookingService = {
  async getAvailableSlots(workspaceSlug, serviceId, staffId, date): Promise<AvailableSlot[]> {
    const result = await getPublicSlotsAction(workspaceSlug, serviceId, staffId, date);
    if (result.ok) return result.data;
    if (result.code === "rate_limited") throw new BookingRateLimitedError();
    return [];
  },

  async createBooking(workspaceSlug, request) {
    const result = await createPublicBookingAction(workspaceSlug, {
      serviceId: request.serviceId,
      staffId: request.staffId,
      date: request.date,
      time: request.time,
      client: request.client,
    });
    if (result.ok) return result.data;
    if (result.code === "rate_limited") throw new BookingRateLimitedError();
    // Unknown workspace, invalid input, a taken slot: from the visitor's side all mean "choose another time".
    throw new BookingUnavailableError();
  },
};
