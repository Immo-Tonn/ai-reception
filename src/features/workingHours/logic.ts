import type { WorkingHoursProfile } from "./types";

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function dateInRange(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

export interface AvailabilityCheck {
  available: boolean;
  reason?: "dayOff" | "outsideHours" | "onBreak" | "timeOff" | "blocked";
}

/**
 * Checks a candidate slot against a staff member's working-hours profile
 * (falling back to the business default when the staff has none) — §5 of
 * the Calendar task: business hours, individual hours, breaks, days off,
 * vacation/absence, manual blocks.
 */
export function checkAvailability(
  ownerId: string,
  date: string,
  time: string,
  durationMinutes: number,
  profiles: WorkingHoursProfile[],
): AvailabilityCheck {
  const profile = profiles.find((p) => p.ownerId === ownerId) ?? profiles.find((p) => p.ownerId === "business");
  if (!profile) return { available: true };

  const start = toMinutes(time);
  const end = start + durationMinutes;
  const weekday = new Date(date + "T00:00:00").getDay();

  const timeOff = profile.timeOff.find((range) => dateInRange(date, range.startDate, range.endDate));
  if (timeOff) return { available: false, reason: "timeOff" };

  const block = profile.blocks.find(
    (b) => b.date === date && start < toMinutes(b.end) && end > toMinutes(b.start),
  );
  if (block) return { available: false, reason: "blocked" };

  const hours = profile.weekly[weekday];
  if (!hours) return { available: false, reason: "dayOff" };

  if (start < toMinutes(hours.start) || end > toMinutes(hours.end)) {
    return { available: false, reason: "outsideHours" };
  }

  const onBreak = profile.breaks.some(
    (b) => b.weekday === weekday && start < toMinutes(b.end) && end > toMinutes(b.start),
  );
  if (onBreak) return { available: false, reason: "onBreak" };

  return { available: true };
}
