import type { Locale } from "@/lib/i18n";
import type { NotificationEvent, NotificationEventType } from "../types";
import { escapeHtml, formatBookingDate, interpolate, resolveLocale } from "./shared";

interface EventCopy {
  subject: string;
  heading: string;
  intro: string;
  outro: string;
}

interface LocaleCopy {
  labels: { business: string; service: string; date: string; time: string; staff: string };
  events: Record<NotificationEventType, EventCopy>;
}

/*
 * Wording is deliberately conservative: it states what happened and the
 * appointment details, and promises nothing the product doesn't do yet
 * (no "we'll remind you", no links to features that aren't built).
 * BOOKING_REMINDER is template foundation only — nothing emits it until
 * a scheduler exists (arrives with the backend).
 */
const copy: Record<Locale, LocaleCopy> = {
  en: {
    labels: { business: "Business", service: "Service", date: "Date", time: "Time", staff: "Staff" },
    events: {
      BOOKING_CONFIRMED: {
        subject: "Booking confirmed — {business}",
        heading: "Booking confirmed",
        intro: "Hello {name}, thank you for booking with {business}. Here are your appointment details.",
        outro: "If your plans change, please contact {business}.",
      },
      BOOKING_RESCHEDULED: {
        subject: "Booking rescheduled — {business}",
        heading: "Booking rescheduled",
        intro: "Hello {name}, your appointment with {business} has been moved. Here are the new details.",
        outro: "If your plans change, please contact {business}.",
      },
      BOOKING_CANCELLED: {
        subject: "Booking cancelled — {business}",
        heading: "Booking cancelled",
        intro: "Hello {name}, your appointment with {business} has been cancelled. These were the details.",
        outro: "You are welcome to book a new appointment at any time.",
      },
      BOOKING_REMINDER: {
        subject: "Appointment reminder — {business}",
        heading: "Appointment reminder",
        intro: "Hello {name}, this is a reminder of your upcoming appointment with {business}.",
        outro: "If your plans change, please contact {business}.",
      },
    },
  },
  de: {
    labels: { business: "Unternehmen", service: "Leistung", date: "Datum", time: "Uhrzeit", staff: "Mitarbeiter" },
    events: {
      BOOKING_CONFIRMED: {
        subject: "Termin bestätigt — {business}",
        heading: "Termin bestätigt",
        intro: "Guten Tag {name}, vielen Dank für Ihre Buchung bei {business}. Hier sind die Details Ihres Termins.",
        outro: "Falls sich Ihre Pläne ändern, wenden Sie sich bitte an {business}.",
      },
      BOOKING_RESCHEDULED: {
        subject: "Termin verschoben — {business}",
        heading: "Termin verschoben",
        intro: "Guten Tag {name}, Ihr Termin bei {business} wurde verschoben. Hier sind die neuen Details.",
        outro: "Falls sich Ihre Pläne ändern, wenden Sie sich bitte an {business}.",
      },
      BOOKING_CANCELLED: {
        subject: "Termin storniert — {business}",
        heading: "Termin storniert",
        intro: "Guten Tag {name}, Ihr Termin bei {business} wurde storniert. Dies waren die Details.",
        outro: "Sie können jederzeit einen neuen Termin buchen.",
      },
      BOOKING_REMINDER: {
        subject: "Terminerinnerung — {business}",
        heading: "Terminerinnerung",
        intro: "Guten Tag {name}, dies ist eine Erinnerung an Ihren bevorstehenden Termin bei {business}.",
        outro: "Falls sich Ihre Pläne ändern, wenden Sie sich bitte an {business}.",
      },
    },
  },
  uk: {
    labels: { business: "Бізнес", service: "Послуга", date: "Дата", time: "Час", staff: "Спеціаліст" },
    events: {
      BOOKING_CONFIRMED: {
        subject: "Запис підтверджено — {business}",
        heading: "Запис підтверджено",
        intro: "Добрий день, {name}! Дякуємо, що записалися до {business}. Ось деталі вашого запису.",
        outro: "Якщо ваші плани зміняться, зверніться до {business}.",
      },
      BOOKING_RESCHEDULED: {
        subject: "Запис перенесено — {business}",
        heading: "Запис перенесено",
        intro: "Добрий день, {name}! Ваш запис до {business} перенесено. Ось нові деталі.",
        outro: "Якщо ваші плани зміняться, зверніться до {business}.",
      },
      BOOKING_CANCELLED: {
        subject: "Запис скасовано — {business}",
        heading: "Запис скасовано",
        intro: "Добрий день, {name}! Ваш запис до {business} скасовано. Ось які були деталі.",
        outro: "Ви можете записатися знову будь-коли.",
      },
      BOOKING_REMINDER: {
        subject: "Нагадування про запис — {business}",
        heading: "Нагадування про запис",
        intro: "Добрий день, {name}! Нагадуємо про ваш найближчий запис до {business}.",
        outro: "Якщо ваші плани зміняться, зверніться до {business}.",
      },
    },
  },
  ru: {
    labels: { business: "Бизнес", service: "Услуга", date: "Дата", time: "Время", staff: "Специалист" },
    events: {
      BOOKING_CONFIRMED: {
        subject: "Запись подтверждена — {business}",
        heading: "Запись подтверждена",
        intro: "Здравствуйте, {name}! Спасибо, что записались в {business}. Вот детали вашей записи.",
        outro: "Если ваши планы изменятся, свяжитесь с {business}.",
      },
      BOOKING_RESCHEDULED: {
        subject: "Запись перенесена — {business}",
        heading: "Запись перенесена",
        intro: "Здравствуйте, {name}! Ваша запись в {business} перенесена. Вот новые детали.",
        outro: "Если ваши планы изменятся, свяжитесь с {business}.",
      },
      BOOKING_CANCELLED: {
        subject: "Запись отменена — {business}",
        heading: "Запись отменена",
        intro: "Здравствуйте, {name}! Ваша запись в {business} отменена. Вот какими были детали.",
        outro: "Вы можете записаться снова в любое время.",
      },
      BOOKING_REMINDER: {
        subject: "Напоминание о записи — {business}",
        heading: "Напоминание о записи",
        intro: "Здравствуйте, {name}! Напоминаем о вашей ближайшей записи в {business}.",
        outro: "Если ваши планы изменятся, свяжитесь с {business}.",
      },
    },
  },
};

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderEmail(event: NotificationEvent): RenderedEmail {
  const locale = resolveLocale(event.locale);
  const { labels, events } = copy[locale];
  const eventCopy = events[event.type];
  const p = event.payload;
  const values = { business: p.businessName, name: p.clientName };

  const rows: [string, string][] = [
    [labels.business, p.businessName],
    [labels.service, p.serviceName],
    [labels.date, formatBookingDate(p.date, locale, "full")],
    [labels.time, p.time],
    [labels.staff, p.staffName],
  ];

  const intro = interpolate(eventCopy.intro, values);
  const outro = interpolate(eventCopy.outro, values);
  const subject = interpolate(eventCopy.subject, values);

  const text = [
    eventCopy.heading,
    "",
    intro,
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    outro,
  ].join("\n");

  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
<h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(eventCopy.heading)}</h1>
<p style="font-size:15px;line-height:1.5;margin:0 0 20px">${escapeHtml(intro)}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">
${rows
  .map(
    ([label, value]) =>
      `<tr><td style="padding:8px 0;color:#6b6b6b;width:40%">${escapeHtml(label)}</td><td style="padding:8px 0;font-weight:600">${escapeHtml(value)}</td></tr>`,
  )
  .join("\n")}
</table>
<p style="font-size:14px;line-height:1.5;color:#6b6b6b;margin:20px 0 0">${escapeHtml(outro)}</p>
</div>`;

  return { subject, text, html };
}
