/**
 * Minimal iCalendar (RFC 5545) writer for appointments — no dependency.
 * Used for the one-off "Add to calendar" file and for a client's
 * subscription feed (all their bookings, kept up to date by the calendar app).
 * Times are always written in UTC ("…Z"), so every calendar shows them in
 * the viewer's own zone correctly.
 */
export interface IcsEvent {
  /** Stable per appointment: the calendar app updates the same event on change. */
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  url?: string;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
  /** Bumped by the feed on every export so apps accept updated details. */
  sequence?: number;
}

const CRLF = "\r\n";

/** Text value escaping (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** UTC date-time "YYYYMMDDTHHMMSSZ". */
export function icsDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Lines longer than 75 octets are folded with CRLF + one space (§3.1), never inside a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join(CRLF + " ");
}

function eventLines(event: IcsEvent, stamp: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${icsDateTime(stamp)}`,
    `DTSTART:${icsDateTime(event.start)}`,
    `DTEND:${icsDateTime(event.end)}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push(`STATUS:${event.status ?? "CONFIRMED"}`);
  if (event.sequence !== undefined) lines.push(`SEQUENCE:${event.sequence}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildIcsCalendar(
  events: IcsEvent[],
  options: { name?: string; refreshMinutes?: number; now?: Date } = {},
): string {
  const stamp = options.now ?? new Date();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ServiceOS//Bookings//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  if (options.name) lines.push(`X-WR-CALNAME:${escapeIcsText(options.name)}`);
  if (options.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${options.refreshMinutes}M`, `X-PUBLISHED-TTL:PT${options.refreshMinutes}M`);
  }
  for (const event of events) lines.push(...eventLines(event, stamp));
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

/** Google Calendar "create event" link (opens Google with the event pre-filled; nothing is stored by ServiceOS). */
export function googleCalendarEventUrl(event: Pick<IcsEvent, "start" | "end" | "summary" | "description">): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.summary,
    dates: `${icsDateTime(event.start)}/${icsDateTime(event.end)}`,
  });
  if (event.description) params.set("details", event.description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
