/**
 * Wall-clock time in a named IANA time zone, using only the standard `Intl`
 * API (no date library).
 *
 * Why: a booking is "Tuesday 09:00 at the salon" — wall-clock time in the
 * BUSINESS's zone — while the server runs in UTC and the visitor may be in
 * another country. The availability engine works on wall-clock strings
 * (`date` + `HH:mm`); the database stores real instants (`timestamptz`).
 * These helpers are the only bridge between the two.
 *
 * Daylight-saving edge cases are handled explicitly:
 *   - A wall time that does NOT exist (clocks jump forward, e.g. Berlin
 *     02:30 on the last Sunday of March) resolves to the first instant after
 *     the gap (03:30 local).
 *   - A wall time that occurs TWICE (clocks go back, e.g. Berlin 02:30 on the
 *     last Sunday of October) resolves to its first occurrence.
 */

export interface WallClock {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsAt(instantMs: number, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(new Date(instantMs))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Offset of `timeZone` from UTC at an instant, in minutes (Berlin summer = +120). */
export function zoneOffsetMinutes(instantMs: number, timeZone: string): number {
  const p = partsAt(instantMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instantMs / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The wall-clock reading of an instant in a zone. */
export function instantToWall(instant: Date | string, timeZone: string): WallClock {
  const ms = typeof instant === "string" ? new Date(instant).getTime() : instant.getTime();
  const p = partsAt(ms, timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** The instant at which a zone's wall clock reads `date` `time`. */
export function wallToInstant(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0);

  const matches = (ms: number) => {
    const w = instantToWall(new Date(ms), timeZone);
    return w.date === date && w.time === time;
  };

  // The offset in force a day before / after brackets any single transition.
  const offBefore = zoneOffsetMinutes(asUtc - 86_400_000, timeZone);
  const offAfter = zoneOffsetMinutes(asUtc + 86_400_000, timeZone);
  const candidates = [...new Set([offBefore, offAfter])]
    .map((off) => asUtc - off * 60_000)
    .filter(matches)
    .sort((a, b) => a - b);

  if (candidates.length > 0) return new Date(candidates[0]); // earliest if ambiguous

  // Non-existent wall time (spring-forward gap): use the pre-transition offset,
  // which lands just after the gap.
  return new Date(asUtc - offBefore * 60_000);
}

/**
 * "Now" expressed as a local-constructed Date whose *local* fields equal the
 * zone's wall clock. The availability engine builds its own slot times the
 * same way (`new Date("YYYY-MM-DDTHH:mm:00")`), so the two compare correctly
 * on any server time zone.
 */
export function nowAsWallClock(now: Date, timeZone: string): Date {
  const p = partsAt(now.getTime(), timeZone);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** Calendar date `days` after `date` (pure string arithmetic, no zone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}
