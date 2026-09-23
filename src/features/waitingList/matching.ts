import type { Appointment } from "@/features/appointments/types";
import type { WaitingListEntry } from "./types";

/** Suggests waiting-list clients for a slot that just opened up (§12). */
export function matchWaitingList(
  opened: Pick<Appointment, "service" | "staff" | "date" | "time">,
  entries: WaitingListEntry[],
): WaitingListEntry[] {
  const weekday = new Date(opened.date + "T00:00:00").getDay();

  return entries.filter((entry) => {
    if (entry.service !== opened.service) return false;
    if (opened.date < entry.earliestDate || opened.date > entry.latestDate) return false;
    if (entry.preferredStaff && entry.preferredStaff !== opened.staff) return false;
    if (entry.preferredDays.length > 0 && !entry.preferredDays.includes(weekday)) return false;
    if (entry.preferredTimeStart && opened.time < entry.preferredTimeStart) return false;
    if (entry.preferredTimeEnd && opened.time > entry.preferredTimeEnd) return false;
    return true;
  });
}
