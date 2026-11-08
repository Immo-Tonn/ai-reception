import type { ExternalBusyInput } from "@/features/appointments/availability";
import type { ExternalBusyMode } from "@/features/externalCalendar/policy";
import type { StaffMember } from "@/features/staff/types";
import { busyRangesToAppointments } from "@/server/booking/busyMapper";
import type { ExternalBusyResult } from "./service";

/** What booking code needs from external calendars: busy time of one workspace for [from, until). */
export type ExternalBusyLoader = (args: {
  workspaceId: string;
  from: Date;
  until: Date;
  mode: ExternalBusyMode;
  /** Limit to these people (e.g. the one being booked) so nobody else's calendar is refreshed. */
  staffIds?: readonly string[];
}) => Promise<ExternalBusyResult>;

/** Service result -> availability-engine input (wall-clock pseudo appointments in the workspace zone). */
export function externalBusyForEngine(result: ExternalBusyResult, timeZone: string, staff: StaffMember[]): ExternalBusyInput {
  const ranges = result.busy.map((b) => ({ staff_id: b.staffId, resource_id: null, busy_from: b.start, busy_until: b.end }));
  return {
    externalBusy: busyRangesToAppointments(ranges, timeZone, staff, "external"),
    externalUnavailableStaffIds: result.unconfirmedStaffIds,
  };
}
