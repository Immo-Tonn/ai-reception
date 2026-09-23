import type { RecurrenceRule } from "./types";
import { localIsoDate } from "@/lib/date/localIsoDate";

/**
 * Expands a recurrence rule into concrete ISO dates, starting from and
 * including `startDate`. Deliberately simple (fixed occurrence count,
 * no RRULE/exceptions engine) — enough to generate a real series of demo
 * appointments and to explain itself to a non-technical reviewer.
 */
export function expandRecurrenceDates(startDate: string, rule: RecurrenceRule): string[] {
  const dates: string[] = [];
  const cursor = new Date(startDate + "T00:00:00");

  const stepDays =
    rule.frequency === "weekly"
      ? 7
      : rule.frequency === "biweekly"
        ? 14
        : rule.frequency === "custom"
          ? Math.max(1, rule.intervalDays ?? 7)
          : null; // monthly handled separately

  for (let i = 0; i < rule.count; i++) {
    dates.push(localIsoDate(cursor));
    if (rule.frequency === "monthly") {
      cursor.setMonth(cursor.getMonth() + 1);
    } else if (stepDays) {
      cursor.setDate(cursor.getDate() + stepDays);
    }
  }

  return dates;
}
