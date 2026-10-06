/**
 * Conversion between the app's "local wall-clock" representation
 * (`date: "YYYY-MM-DD"`, `time: "HH:mm"`, interpreted in a workspace's
 * IANA time zone) and the absolute instants stored in Postgres
 * (`timestamptz`). Pure and dependency-free (Intl only), so it runs the
 * same in Node, the browser and Vitest.
 */

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInZone(instantMs: number, timeZone: string): Parts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(instantMs))) {
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

/** Offset (ms) of `timeZone` from UTC at the given instant: local - UTC. */
function offsetMs(instantMs: number, timeZone: string): number {
  const p = partsInZone(instantMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The absolute instant at which the wall clock in `timeZone` reads
 * `date` + `time`. For a time that doesn't exist (spring-forward gap)
 * the clock is moved forward; for an ambiguous one (autumn overlap) the
 * earlier instant is used.
 */
export function zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);

  const firstOffset = offsetMs(guess, timeZone);
  let result = guess - firstOffset;
  const secondOffset = offsetMs(result, timeZone);
  if (secondOffset !== firstOffset) {
    result = guess - secondOffset;
  }
  return new Date(result);
}

/** The wall-clock date/time `instant` shows in `timeZone`. */
export function utcToZonedParts(
  instant: Date | string,
  timeZone: string,
): { date: string; time: string } {
  const ms = typeof instant === "string" ? new Date(instant).getTime() : instant.getTime();
  const p = partsInZone(ms, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

/** Day of week (0 = Sunday) of a "YYYY-MM-DD" calendar date. */
export function weekdayOfDate(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}
