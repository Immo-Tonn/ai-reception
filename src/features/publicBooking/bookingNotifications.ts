import { getWorkspaceConfig } from "@/features/workspace/registry";
import type { Appointment } from "@/features/appointments/types";
import {
  notificationService as defaultService,
  type NotificationService,
} from "@/features/notifications/notificationService";
import type {
  BookingNotificationPayload,
  NotificationEventType,
} from "@/features/notifications/types";
import { reportError } from "@/lib/errorReporter";
import type { Locale } from "@/lib/i18n";

export interface BookingContact {
  name: string;
  email: string;
  phone?: string;
}

/**
 * Builds the client-facing payload from an Appointment by picking ONLY
 * the fields a client message needs. Internal notes, visibility,
 * financial bucket, price and paid state are never read here — and since
 * this is an explicit pick (not a spread), a field added to Appointment
 * later cannot leak into a notification by accident.
 */
export function buildBookingPayload(
  workspaceSlug: string,
  appointment: Appointment,
  contact: BookingContact,
): BookingNotificationPayload {
  return {
    workspaceSlug,
    businessName: getWorkspaceConfig(workspaceSlug).name,
    clientName: contact.name,
    clientEmail: contact.email,
    ...(contact.phone ? { clientPhone: contact.phone } : {}),
    serviceName: appointment.service,
    date: appointment.date,
    time: appointment.time,
    staffName: appointment.staff,
    appointmentId: appointment.id,
  };
}

/**
 * Fire-and-forget from the booking flow's point of view: the booking is
 * already saved when this runs, so a notification problem is reported
 * and swallowed — it must never reject, roll back or hide the booking.
 */
export async function notifyBookingEvent(
  type: NotificationEventType,
  params: {
    workspaceSlug: string;
    appointment: Appointment;
    contact: BookingContact;
    locale: Locale;
  },
  service: NotificationService = defaultService,
): Promise<void> {
  try {
    await service.notify({
      type,
      payload: buildBookingPayload(params.workspaceSlug, params.appointment, params.contact),
      locale: params.locale,
    });
  } catch (error) {
    reportError(`notifyBookingEvent ${type}`, error);
  }
}
