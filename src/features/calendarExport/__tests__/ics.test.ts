import { describe, expect, it } from "vitest";
import { buildIcsCalendar, escapeIcsText, foldIcsLine, googleCalendarEventUrl, icsDateTime } from "../ics";

const start = new Date("2026-10-26T09:00:00Z");
const end = new Date("2026-10-26T09:45:00Z");

describe("iCalendar writer", () => {
  it("writes UTC times and escapes text", () => {
    expect(icsDateTime(start)).toBe("20261026T090000Z");
    expect(escapeIcsText("Cut, wash; style\\done\nnote")).toBe("Cut\\, wash\; style\\\\done\\nnote");
  });

  it("folds long lines at 75 octets without breaking a UTF-8 character", () => {
    const folded = foldIcsLine("SUMMARY:" + "Ä".repeat(60));
    for (const line of folded.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join("")).toBe("SUMMARY:" + "Ä".repeat(60));
  });

  it("builds a valid calendar with CRLF, stable UID and status", () => {
    const ics = buildIcsCalendar(
      [
        { uid: "appointment-1@serviceos", start, end, summary: "Haircut · Beauty Salon", status: "CONFIRMED", sequence: 3 },
        { uid: "appointment-2@serviceos", start, end, summary: "Cancelled one", status: "CANCELLED" },
      ],
      { name: "My bookings", refreshMinutes: 60, now: new Date("2026-10-24T08:00:00Z") },
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:appointment-1@serviceos\r\n");
    expect(ics).toContain("DTSTART:20261026T090000Z\r\nDTEND:20261026T094500Z\r\n");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("REFRESH-INTERVAL;VALUE=DURATION:PT60M");
    expect(ics).toContain("X-WR-CALNAME:My bookings");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).not.toMatch(/[^\r]\n/); // only CRLF line breaks
  });

  it("Google link carries the event, nothing else", () => {
    const url = new URL(googleCalendarEventUrl({ start, end, summary: "Haircut · Beauty Salon" }));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261026T090000Z/20261026T094500Z");
    expect(url.searchParams.get("text")).toBe("Haircut · Beauty Salon");
  });
});
