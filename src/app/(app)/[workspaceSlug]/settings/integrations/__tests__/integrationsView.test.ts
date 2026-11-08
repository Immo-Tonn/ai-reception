import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getMessages, locales } from "@/lib/i18n";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/server/actions/externalCalendar.actions", () => ({
  createCalendarConnectLinkAction: vi.fn(),
  refreshCalendarAction: vi.fn(),
  disconnectCalendarAction: vi.fn(),
}));
const { IntegrationsView } = await import("../IntegrationsView");

const data = {
  overview: {
    configured: true,
    managesAll: true,
    ownStaffId: "s-own",
    connections: [
      { staffId: "s-own", provider: "google" as const, status: "connected" as const, calendarCount: 2, lastSuccessAt: "2026-10-13T08:00:00.000Z", lastErrorCode: null, lastErrorAt: null, connectedAt: "2026-10-01T00:00:00.000Z" },
      { staffId: "s-err", provider: "google" as const, status: "error" as const, calendarCount: 1, lastSuccessAt: null, lastErrorCode: "unavailable" as const, lastErrorAt: "2026-10-13T08:00:00.000Z", connectedAt: "2026-10-01T00:00:00.000Z" },
    ],
  },
  staff: [
    { id: "s-own", name: "Anna" },
    { id: "s-err", name: "Ben" },
    { id: "s-none", name: "Clara" },
  ],
  conflicts: [{ appointmentId: "a1", staffId: "s-own", date: "2026-10-20", time: "14:00", durationMinutes: 60, service: null, staffName: "Anna" }],
};

const render = (locale: (typeof locales)[number], over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(IntegrationsView, {
      workspaceSlug: "biz",
      businessName: "Biz",
      locale,
      demo: false,
      forbidden: false,
      data,
      messages: getMessages(locale).calendarIntegration,
      backLabel: "Back",
      discard: { discardTitle: "", discardText: "", discard: "", keepEditing: "" },
      ...over,
    }),
  );

describe("Settings -> Google Calendar view", () => {
  it.each(locales)("%s: statuses, actions, privacy text and conflicts render", (locale) => {
    const m = getMessages(locale).calendarIntegration;
    const html = render(locale);
    for (const s of [m.statusConnected, m.statusError, m.statusNotConnected, m.privacy1, m.privacy2, m.connectOwn.length ? m.reconnect : "", m.createLink, m.checkNow, m.disconnect, m.errUnavailable, m.unconfirmedHint, m.conflictsTitle, m.privateAppointment]) {
      expect(html).toContain(s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;"));
    }
    expect(html).toContain(m.calendarsCount.replace("{n}", "2"));
  });

  it("not configured: explains it and offers no connect buttons", () => {
    const m = getMessages("en").calendarIntegration;
    const html = render("en", { data: { ...data, overview: { ...data.overview, configured: false } } });
    expect(html).toContain(m.notConfigured);
    expect(html).not.toContain(m.createLink);
  });

  it("never renders calendar ids, names or tokens (the summary has none)", () => {
    const html = render("en");
    expect(html).not.toMatch(/v1\.|refresh|@primary/);
  });
});
