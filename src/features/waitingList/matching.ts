import type { Appointment } from "@/features/appointments/types";
import { isActiveWaitingStatus, type WaitingListEntry } from "./types";

/** Suggests waiting-list clients for a slot that just opened up (§12). Booked/closed entries never match. */
export function matchWaitingList(
  opened: Pick<Appointment, "service" | "staff" | "date" | "time">,
  entries: WaitingListEntry[],
): WaitingListEntry[] {
  const weekday = new Date(opened.date + "T00:00:00").getDay();

  return entries.filter((entry) => {
    if (!isActiveWaitingStatus(entry.status)) return false;
    if (entry.service !== opened.service) return false;
    if (opened.date < entry.earliestDate || opened.date > entry.latestDate) return false;
    if (entry.preferredStaff && entry.preferredStaff !== opened.staff) return false;
    if (entry.preferredDays.length > 0 && !entry.preferredDays.includes(weekday)) return false;
    if (entry.preferredTimeStart && opened.time < entry.preferredTimeStart) return false;
    if (entry.preferredTimeEnd && opened.time > entry.preferredTimeEnd) return false;
    return true;
  });
}

/** Link to the Calendar create flow, prefilled with what the Calendar supports (client name + first day). */
export function bookingLinkForEntry(workspaceSlug: string, entry: WaitingListEntry, today: string): string {
  const params = new URLSearchParams({ create: "appointment", client: entry.client });
  params.set("date", entry.earliestDate > today ? entry.earliestDate : entry.latestDate >= today ? today : entry.latestDate);
  return `/${workspaceSlug}/calendar?${params.toString()}`;
}
