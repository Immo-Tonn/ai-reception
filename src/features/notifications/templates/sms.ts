import type { Locale } from "@/lib/i18n";
import type { NotificationEvent, NotificationEventType } from "../types";
import { formatBookingDate, interpolate, resolveLocale } from "./shared";

/** Deliberately short: business, what happened, service, date, time. */
const copy: Record<Locale, Record<NotificationEventType, string>> = {
  en: {
    BOOKING_CONFIRMED: "{business}: booking confirmed. {service}, {date}, {time}.",
    BOOKING_RESCHEDULED: "{business}: booking rescheduled. {service}, {date}, {time}.",
    BOOKING_CANCELLED: "{business}: booking cancelled. {service}, {date}, {time}.",
    BOOKING_REMINDER: "{business}: reminder. {service}, {date}, {time}.",
  },
  de: {
    BOOKING_CONFIRMED: "{business}: Termin bestätigt. {service}, {date}, {time} Uhr.",
    BOOKING_RESCHEDULED: "{business}: Termin verschoben. {service}, {date}, {time} Uhr.",
    BOOKING_CANCELLED: "{business}: Termin storniert. {service}, {date}, {time} Uhr.",
    BOOKING_REMINDER: "{business}: Erinnerung. {service}, {date}, {time} Uhr.",
  },
  uk: {
    BOOKING_CONFIRMED: "{business}: запис підтверджено. {service}, {date}, {time}.",
    BOOKING_RESCHEDULED: "{business}: запис перенесено. {service}, {date}, {time}.",
    BOOKING_CANCELLED: "{business}: запис скасовано. {service}, {date}, {time}.",
    BOOKING_REMINDER: "{business}: нагадування. {service}, {date}, {time}.",
  },
  ru: {
    BOOKING_CONFIRMED: "{business}: запись подтверждена. {service}, {date}, {time}.",
    BOOKING_RESCHEDULED: "{business}: запись перенесена. {service}, {date}, {time}.",
    BOOKING_CANCELLED: "{business}: запись отменена. {service}, {date}, {time}.",
    BOOKING_REMINDER: "{business}: напоминание. {service}, {date}, {time}.",
  },
};

export function renderSms(event: NotificationEvent): string {
  const locale = resolveLocale(event.locale);
  const p = event.payload;
  return interpolate(copy[locale][event.type], {
    business: p.businessName,
    service: p.serviceName,
    date: formatBookingDate(p.date, locale, "medium"),
    time: p.time,
  });
}
