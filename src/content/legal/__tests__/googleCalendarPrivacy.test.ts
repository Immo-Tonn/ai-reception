import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { locales, type Locale } from "@/lib/i18n";
import { datenschutzApproved } from "../datenschutz";
import { GOOGLE_API_USER_DATA_POLICY_URL, GOOGLE_CALENDAR_SECTION_ID, googleCalendarIntegrationLive, googleCalendarPrivacy } from "../googleCalendarPrivacy";

let current: Locale = "de";
vi.mock("@/lib/i18n/next", () => ({ getRequestLocale: async () => current }));
// LegalPage is an async server component (locale, footer); the section under test is its children.
vi.mock("@/components/legal/LegalPage/LegalPage", () => ({ LegalPage: ({ children }: { children: unknown }) => children }));
const { default: DatenschutzPage } = await import("@/app/datenschutz/page");

const all = (l: Locale) => {
  const t = googleCalendarPrivacy[l];
  return [t.title, t.draftNote, t.notLiveNote, ...t.blocks.flatMap((b) => [b.heading, ...(b.paragraphs ?? []), ...(b.items ?? []), ...(b.after ?? [])]), t.reviewTitle, ...t.reviewNotes].join("\n");
};

describe("Datenschutz: Google Calendar section (draft for legal review)", () => {
  it("stays a draft: the Datenschutzerklärung is NOT marked approved, and the integration is not presented as live", () => {
    expect(datenschutzApproved).toBe(false);
    expect(googleCalendarIntegrationLive).toBe(false);
  });

  it("all four locales have the same structure", () => {
    const shape = (l: Locale) => googleCalendarPrivacy[l].blocks.map((b) => [b.paragraphs?.length ?? 0, b.items?.length ?? 0, b.after?.length ?? 0]);
    for (const l of locales) {
      expect(shape(l)).toEqual(shape("de"));
      expect(googleCalendarPrivacy[l].reviewNotes.length).toBe(googleCalendarPrivacy.de.reviewNotes.length);
      expect(all(l)).toContain("Needs legal review");
      expect(all(l)).toContain("Google API Services User Data Policy");
      expect(all(l)).toContain("Limited Use");
      expect(all(l)).toContain("AES-256-GCM");
      expect(all(l)).toContain("183");
      expect(all(l)).toContain("calendar.freebusy");
      expect(all(l)).toContain("calendar.calendarlist.readonly");
      expect(all(l)).toContain("openid");
      expect(all(l)).toContain("HMAC-SHA256");
      expect(all(l)).toContain("/connect-calendar/manage");
    }
  });

  it("German text discloses what IS stored (no false 'we store nothing' claim)", () => {
    const de = all("de");
    for (const fact of [
      "Kennungen der ausgewählten Kalender", "E-Mail-Adresse", "Refresh Token", "Verbindungsstatus", "Zwischenspeicher", "SHA-256",
      "sofort aus der Datenbank gelöscht", "Doppelbuchungen", "„openid“", "HMAC-SHA256", "/connect-calendar/manage", "24 Stunden", "30 Tage",
      "für alle Verbindungen eines Google-Kontos", "minimaler technischer Status", "deaktiviert", "Sicherungen", "sofortige Löschung aus allen Sicherungen ist nicht möglich",
    ]) {
      expect(de).toContain(fact);
    }
    expect(de).not.toMatch(/speichert keine (personenbezogenen )?Daten|keine Daten gespeichert/i);
    // Never promises instant deletion from backups.
    expect(de).not.toMatch(/sofort aus allen Sicherungen gelöscht|Sicherungen werden sofort/);
  });

  it("unconfirmed legal points are listed as open, not asserted", () => {
    const notes = googleCalendarPrivacy.de.reviewNotes.join("\n");
    for (const topic of ["Rechtsgrundlage", "Verantwortlicher", "Auftragsverarbeitungsverträge", "Drittland", "Datensicherungen", "Speicherfristen", "iad1", "Art. 13"]) expect(notes).toContain(topic);
  });

  it.each(locales)("%s: /datenschutz renders the section with anchor, draft marker and policy link", async (l) => {
    current = l;
    const html = renderToStaticMarkup(await DatenschutzPage());
    const t = googleCalendarPrivacy[l];
    expect(html).toContain(`id="${GOOGLE_CALENDAR_SECTION_ID}"`);
    expect(html).toContain(`href="#${GOOGLE_CALENDAR_SECTION_ID}"`);
    expect(html).toContain(t.reviewTitle);
    expect(html).toContain(GOOGLE_API_USER_DATA_POLICY_URL);
    expect(html).toContain(t.notLiveNote);
  });
});
