import { describe, expect, it, vi } from "vitest";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import { getPublicBookingService } from "@/features/publicBooking/bookingService";
import { buildBookingPayload } from "@/features/publicBooking/bookingNotifications";
import type { Appointment } from "@/features/appointments/types";
import {
  createNotificationService,
  notificationService,
  type NotificationService,
} from "../notificationService";
import { createConsoleNotificationProvider } from "../providers/ConsoleNotificationProvider";
import { defaultNotificationPreferences } from "../preferences";
import { renderEmail } from "../templates/email";
import { renderSms } from "../templates/sms";
import type { NotificationEvent, NotificationEventType } from "../types";
import type { Locale } from "@/lib/i18n";

const WORKSPACE = "demo-salon";

const appointment: Appointment = {
  id: "appt-1",
  client: "Anna Müller",
  service: "Haircut",
  staff: "Elena",
  resourceId: null,
  date: "2026-10-05",
  time: "10:00",
  durationMinutes: 45,
  price: 99,
  currency: "EUR",
  notes: "INTERNAL: pays cash, prefers no small talk",
  visibility: "private",
  financialBucket: "private",
  status: "confirmed",
  paid: true,
  seriesId: null,
  recurrence: null,
};
const contact = { name: "Anna Müller", email: "anna@example.com", phone: "+49 176 1234567" };

async function findBookableSlot() {
  const service = getWorkspaceConfig(WORKSPACE).services[0];
  for (let offset = 14; offset < 90; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const slots = await getPublicBookingService(WORKSPACE).getAvailableSlots(WORKSPACE, service.id, null, date);
    if (slots.length > 0) return { service, date, time: slots[0].time };
  }
  throw new Error("no bookable slot found for the test");
}

describe("booking → notification events", () => {
  it("a public booking raises BOOKING_CONFIRMED with the client's locale", async () => {
    const { service, date, time } = await findBookableSlot();
    const events: NotificationEvent[] = [];
    const spy = vi.spyOn(notificationService, "notify").mockImplementation(async (event) => {
      events.push(event);
      return { results: [], skipped: [] };
    });
    const created = await getPublicBookingService(WORKSPACE).createBooking(WORKSPACE, {
      serviceId: service.id,
      staffId: null,
      date,
      time,
      client: { name: "Anna Müller", email: "anna@example.com", phone: "+49 176 1234567", notes: "" },
      locale: "de",
    });
    spy.mockRestore();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("BOOKING_CONFIRMED");
    expect(events[0].locale).toBe("de");
    expect(events[0].payload).toMatchObject({
      workspaceSlug: WORKSPACE,
      clientEmail: "anna@example.com",
      date,
      time,
      appointmentId: created.appointmentId,
    });
  });

  it("a notification failure does NOT undo or fail the booking", async () => {
    const { service, date, time } = await findBookableSlot();
    const spy = vi.spyOn(notificationService, "notify").mockRejectedValue(new Error("provider exploded"));
    const created = await getPublicBookingService(WORKSPACE).createBooking(WORKSPACE, {
      serviceId: service.id,
      staffId: null,
      date,
      time,
      client: { name: "Anna Müller", email: "anna@example.com", phone: "", notes: "" },
    });
    spy.mockRestore();
    expect(created.appointmentId).toBeTruthy();
    expect(created.date).toBe(date);
  });
});

// `cancelClientBooking`/`rescheduleClientBooking` (the old client-side notify-on-cancel/reschedule
// path) were removed with `manageBooking.ts`: PR #6 replaced client-side cancel/reschedule with
// server-side `cancelMyBookingAction`/`rescheduleMyBookingAction` (src/server/clientAccount/
// clientAccount.service.ts), which do not yet raise BOOKING_CANCELLED/BOOKING_RESCHEDULED.
// Wiring notifyBookingEvent into that service is a follow-up, not part of this merge.

describe("client notification payload", () => {
  it("contains only the whitelisted fields — no internal notes, visibility, bucket or price", () => {
    const payload = buildBookingPayload(WORKSPACE, appointment, contact);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "appointmentId",
        "businessName",
        "clientEmail",
        "clientName",
        "clientPhone",
        "date",
        "serviceName",
        "staffName",
        "time",
        "workspaceSlug",
      ].sort(),
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("INTERNAL");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("99");
  });

  it("omits the phone when there is none", () => {
    const payload = buildBookingPayload(WORKSPACE, appointment, { name: "A", email: "a@b.co" });
    expect("clientPhone" in payload).toBe(false);
  });
});

describe("NotificationService", () => {
  const event: NotificationEvent = {
    type: "BOOKING_CONFIRMED",
    payload: buildBookingPayload(WORKSPACE, appointment, contact),
    locale: "en",
  };

  it("never throws when a provider fails, and reports the failure", async () => {
    const reporter = vi.fn();
    const service = createNotificationService({
      providers: [
        {
          channel: "EMAIL",
          async send() {
            throw new Error("smtp down");
          },
        },
      ],
      reporter,
    });
    const result = await service.notify(event);
    expect(result.results[0]).toMatchObject({ channel: "EMAIL", ok: false, delivered: false });
    expect(reporter).toHaveBeenCalled();
  });

  it("default preferences: email on only if an address exists; sms/push off", () => {
    expect(defaultNotificationPreferences({ email: "a@b.co" })).toEqual({ email: true, sms: false, push: false });
    expect(defaultNotificationPreferences({ email: "  " })).toEqual({ email: false, sms: false, push: false });
  });

  it("respects preferences: SMS is skipped by default even when a phone exists", async () => {
    const sent: string[] = [];
    const log = (message: string) => sent.push(message);
    const service = createNotificationService({
      providers: [createConsoleNotificationProvider("EMAIL", log), createConsoleNotificationProvider("SMS", log)],
    });
    const result = await service.notify(event);
    expect(result.results.map((r) => r.channel)).toEqual(["EMAIL"]);
    expect(result.skipped).toContain("SMS");
  });

  it("the Console/Mock provider never claims delivery", async () => {
    const service = createNotificationService({
      providers: [createConsoleNotificationProvider("EMAIL", () => {})],
    });
    const result = await service.notify(event);
    expect(result.results[0]).toMatchObject({ ok: true, delivered: false });
  });
});

describe("templates (DE / EN / UK / RU)", () => {
  const locales: Locale[] = ["de", "en", "uk", "ru"];
  const types: NotificationEventType[] = [
    "BOOKING_CONFIRMED",
    "BOOKING_RESCHEDULED",
    "BOOKING_CANCELLED",
    "BOOKING_REMINDER",
  ];
  const payload = buildBookingPayload(WORKSPACE, appointment, contact);

  it("renders every event in every locale with the appointment details", () => {
    for (const locale of locales) {
      for (const type of types) {
        const email = renderEmail({ type, payload, locale });
        expect(email.subject).toContain(payload.businessName);
        expect(email.text).toContain("Haircut");
        expect(email.text).toContain("10:00");
        expect(email.text).toContain("Elena");
        expect(email.html).toContain("<table");
        const sms = renderSms({ type, payload, locale });
        expect(sms).toContain(payload.businessName);
        expect(sms).toContain("10:00");
        expect(sms.length).toBeLessThan(160);
      }
    }
  });

  it("uses the right language per locale", () => {
    const heading = (locale: Locale) => renderEmail({ type: "BOOKING_CONFIRMED", payload, locale }).text;
    expect(heading("en")).toContain("Booking confirmed");
    expect(heading("de")).toContain("Termin bestätigt");
    expect(heading("uk")).toContain("Запис підтверджено");
    expect(heading("ru")).toContain("Запись подтверждена");
  });

  it("falls back to English for an unknown locale", () => {
    const email = renderEmail({ type: "BOOKING_CANCELLED", payload, locale: "xx" as Locale });
    expect(email.text).toContain("Booking cancelled");
  });

  it("escapes HTML in client-supplied values", () => {
    const evil = { ...payload, clientName: "<script>alert(1)</script>" };
    const email = renderEmail({ type: "BOOKING_CONFIRMED", payload: evil, locale: "en" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("never claims an email/SMS was already sent", () => {
    for (const locale of locales) {
      const text = renderEmail({ type: "BOOKING_CONFIRMED", payload, locale }).text.toLowerCase();
      expect(text).not.toMatch(/we('|’)ve sent|wir haben.*gesendet|ми надіслали|мы отправили/);
    }
  });
});
