import "server-only";
import type { Session } from "@/server/auth/session";
import { can } from "@/server/permissions/roles";
import {
  getServerAppointmentsRepository,
  getServerServicesRepository,
  getServerStaffRepository,
} from "@/server/repository/registry";
import { findExternalConflicts } from "@/features/externalCalendar/conflicts";
import type { ExternalCalendarConflict } from "@/features/externalCalendar/types";
import { addDays, instantToWall } from "@/lib/time/zonedTime";
import { getExternalCalendarDeps } from "@/server/externalCalendar/deps";
import { externalBusyForEngine } from "@/server/externalCalendar/engineInput";
import { getExternalCalendarOverview, loadExternalBusy, type ExternalCalendarOverview } from "@/server/externalCalendar/service";
import { applyVisibility } from "./masking";
import { getWorkspaceTimeZone } from "./finance.service";

/** How far ahead the Settings page looks for ServiceOS appointments that collide with Google busy time. */
const CONFLICT_LOOKAHEAD_DAYS = 90;

export interface CalendarSettingsData {
  overview: ExternalCalendarOverview;
  staff: { id: string; name: string }[];
  /** Owner/admin only; `service` is null for appointments the viewer may not see in detail. */
  conflicts: (Omit<ExternalCalendarConflict, "service"> & { service: string | null; staffName: string })[];
}

/**
 * Everything Settings -> Google Calendar shows. Status only (no tokens, no
 * calendar ids or names). Conflicts are computed from the CACHED busy time
 * (browse freshness) and never acted upon.
 */
export async function getCalendarSettingsData(session: Session): Promise<CalendarSettingsData> {
  const deps = getExternalCalendarDeps();
  const overview = await getExternalCalendarOverview(deps, session);
  const allStaff = (await getServerStaffRepository(session.workspaceId).list()).filter((s) => s.active !== false);
  const staff = (overview.managesAll ? allStaff : allStaff.filter((s) => s.id === overview.ownStaffId)).map((s) => ({ id: s.id, name: s.name }));

  let conflicts: CalendarSettingsData["conflicts"] = [];
  const connectedIds = overview.connections.filter((c) => c.status !== "revoked").map((c) => c.staffId);
  const tz = await getWorkspaceTimeZone(session);
  if (overview.managesAll && can(session.role, "appointments.view") && connectedIds.length > 0 && tz) {
    const now = new Date();
    const today = instantToWall(now, tz).date;
    const [appointments, services, busy] = await Promise.all([
      getServerAppointmentsRepository(session.workspaceId).list(),
      getServerServicesRepository(session.workspaceId).list(),
      loadExternalBusy(deps, {
        workspaceId: session.workspaceId,
        staffIds: connectedIds,
        mode: "browse",
        from: now,
        until: new Date(now.getTime() + CONFLICT_LOOKAHEAD_DAYS * 86_400_000),
      }),
    ]);
    const lastDay = addDays(today, CONFLICT_LOOKAHEAD_DAYS);
    const upcoming = appointments.filter((a) => a.date >= today && a.date <= lastDay && a.staffId && connectedIds.includes(a.staffId));
    const { externalBusy = [] } = externalBusyForEngine(busy, tz, allStaff);
    const names = new Map(allStaff.map((s) => [s.id, s.name]));
    const byId = new Map(upcoming.map((a) => [a.id, a]));
    conflicts = findExternalConflicts(upcoming, externalBusy, services).map((c) => {
      const visible = applyVisibility(byId.get(c.appointmentId)!, session);
      return { ...c, service: visible.masked ? null : c.service, staffName: names.get(c.staffId) ?? "" };
    });
  }
  return { overview, staff, conflicts };
}
