import { getAppointmentsRepository } from "@/features/appointments/repository";
import type { Appointment } from "@/features/appointments/types";
import type { NotificationService } from "@/features/notifications/notificationService";
import type { Locale } from "@/lib/i18n";
import { notifyBookingEvent, type BookingContact } from "./bookingNotifications";

/**
 * Client-side cancel/reschedule — the one place the My Bookings screen
 * mutates a booking, so the matching notification event is raised from
 * the application layer rather than from a component. The booking is
 * updated FIRST; the notification runs after and cannot undo it.
 */
export async function cancelClientBooking(
  workspaceSlug: string,
  appointment: Appointment,
  contact: BookingContact,
  locale: Locale,
  notifications?: NotificationService,
): Promise<void> {
  await getAppointmentsRepository(workspaceSlug).update(appointment.id, { status: "cancelled" });
  await notifyBookingEvent(
    "BOOKING_CANCELLED",
    { workspaceSlug, appointment, contact, locale },
    notifications,
  );
}

export interface RescheduleTarget {
  date: string;
  time: string;
  staff: string;
  resourceId: string | null;
}

export async function rescheduleClientBooking(
  workspaceSlug: string,
  appointment: Appointment,
  target: RescheduleTarget,
  contact: BookingContact,
  locale: Locale,
  notifications?: NotificationService,
): Promise<void> {
  const updated = await getAppointmentsRepository(workspaceSlug).update(appointment.id, target);
  await notifyBookingEvent(
    "BOOKING_RESCHEDULED",
    { workspaceSlug, appointment: updated ?? { ...appointment, ...target }, contact, locale },
    notifications,
  );
}
