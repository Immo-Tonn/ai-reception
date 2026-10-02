import type { Appointment } from "@/features/appointments/types";
import type { StaffMember } from "@/features/staff/types";
import { addDays, instantToWall } from "@/lib/time/zonedTime";

export interface BusyRange {
  staff_id: string | null;
  resource_id: string | null;
  busy_from: string;
  busy_until: string;
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * Occupied ranges (already INCLUDING service buffers, see `busy_from` /
 * `busy_until`) -> the minimal `Appointment` objects the availability engine's
 * conflict check understands. They carry no `serviceId`, so the engine adds no
 * second buffer on top. A range crossing midnight is split per calendar day
 * (wall clock in the business's zone).
 */
export function busyRangesToAppointments(ranges: BusyRange[], timeZone: string, staff: StaffMember[]): Appointment[] {
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const out: Appointment[] = [];
  let seq = 0;

  for (const range of ranges) {
    let cursor = instantToWall(range.busy_from, timeZone);
    const end = instantToWall(range.busy_until, timeZone);
    let guard = 0;
    while (guard++ < 4) {
      const lastOfThisDay = cursor.date === end.date;
      const fromMin = toMinutes(cursor.time);
      const toMin = lastOfThisDay ? toMinutes(end.time) : 24 * 60;
      if (toMin > fromMin) {
        out.push({
          id: `busy-${seq++}`,
          client: "",
          service: "",
          staff: range.staff_id ? (names.get(range.staff_id) ?? "") : "",
          ...(range.staff_id ? { staffId: range.staff_id } : {}),
          resourceId: range.resource_id,
          date: cursor.date,
          time: cursor.time,
          durationMinutes: toMin - fromMin,
          price: 0,
          currency: "EUR",
          notes: "",
          visibility: "normal",
          financialBucket: "main",
          status: "confirmed",
          paid: false,
          seriesId: null,
          recurrence: null,
        });
      }
      if (lastOfThisDay) break;
      cursor = { date: addDays(cursor.date, 1), time: "00:00" };
    }
  }
  return out;
}
