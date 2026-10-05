import "server-only";
import type { Session } from "@/server/auth/session";
import {
  getServerResourcesRepository,
  getServerServicesRepository,
  getServerStaffRepository,
  getServerScheduling,
} from "@/server/repository/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { defaultBookingRules, slotIntervalOptions, type BookingRules } from "@/features/scheduling/types";
import type { WorkspaceCatalogData } from "@/features/workspace/WorkspaceCatalog";

/**
 * Catalog of a REAL workspace for the business screens (services, staff,
 * resources, working hours, name, time zone) — read as the signed-in user
 * under Row Level Security.
 */
export async function loadWorkspaceCatalog(session: Session, slug: string): Promise<WorkspaceCatalogData> {
  const client = await createSupabaseServerClient();
  const wid = session.workspaceId;
  const [workspace, services, staff, resources, scheduling, staffRows, resourceRows, links] = await Promise.all([
    // `*`: the 0019 rule columns may not exist yet in every environment.
    client.from("workspaces").select("*").eq("id", wid).maybeSingle(),
    getServerServicesRepository(wid).list(),
    getServerStaffRepository(wid).list(),
    getServerResourcesRepository(wid).list(),
    getServerScheduling(wid),
    client.from("staff_profiles").select("*").eq("workspace_id", wid),
    client.from("resources").select("*").eq("workspace_id", wid),
    client.from("service_resources").select("service_id,resource_id"),
  ]);
  const ws = (workspace.data ?? {}) as Record<string, unknown>;

  const extra = new Map(((staffRows.error ? [] : staffRows.data) as StaffDbRow[] | null ?? []).map((r) => [r.id, r]));
  const sortedStaff = staff
    .map((s) => {
      const r = extra.get(s.id);
      return {
        ...s,
        ...(r?.title ? { title: r.title } : {}),
        ...(r?.schedule_mode === "inherit" ? { scheduleMode: "inherit" as const } : r?.schedule_mode === "custom" ? { scheduleMode: "custom" as const } : {}),
        sortOrder: r?.sort_order ?? 0,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const inactiveStaff = [...extra.values()].filter((r) => r.active === false).map((r) => ({ id: r.id, name: r.name }));

  const resExtra = new Map(((resourceRows.error ? [] : resourceRows.data) as ResourceDbRow[] | null ?? []).map((r) => [r.id, r]));
  const linkRows = (links.error ? [] : (links.data as { service_id: string; resource_id: string }[] | null) ?? []);

  return {
    slug,
    name: (ws.name as string | undefined) ?? slug,
    timezone: (ws.timezone as string | undefined) ?? "Europe/Berlin",
    // Archived services are not offered for new appointments; old appointments keep their name.
    services: services
      .filter((s) => s.active !== false)
      .map((s) => ({ ...s, resourceIds: linkRows.filter((l) => l.service_id === s.id).map((l) => l.resource_id) })),
    staff: sortedStaff,
    inactiveStaff,
    resources: resources
      .map((r) => ({ ...r, active: true, description: resExtra.get(r.id)?.description ?? "", sortOrder: resExtra.get(r.id)?.sort_order ?? 0 }))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    workingHours: scheduling.workingHours,
    timeOff: scheduling.timeOff,
    bookingRules: rulesFromWorkspaceRow(ws),
  };
}

interface StaffDbRow {
  id: string;
  name: string;
  active?: boolean;
  title?: string;
  schedule_mode?: string;
  sort_order?: number;
}
interface ResourceDbRow {
  id: string;
  description?: string;
  sort_order?: number;
}

/** `workspaces` row -> booking rules; missing/invalid columns fall back to the defaults. */
export function rulesFromWorkspaceRow(ws: Record<string, unknown>): BookingRules {
  const int = (v: unknown, min: number, max: number, d: number) =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : d;
  const interval = ws.slot_interval_minutes;
  return {
    autoConfirm: ws.auto_confirm_bookings === true,
    minNoticeMinutes: int(ws.min_notice_minutes, 0, 60 * 24 * 30, defaultBookingRules.minNoticeMinutes),
    maxHorizonDays: int(ws.max_horizon_days, 1, 180, defaultBookingRules.maxHorizonDays),
    slotIntervalMinutes: (slotIntervalOptions as readonly number[]).includes(interval as number) ? (interval as number) : defaultBookingRules.slotIntervalMinutes,
    cancellationDeadlineHours: int(ws.cancellation_deadline_hours, 0, 24 * 90, 0),
    rescheduleDeadlineHours: int(ws.reschedule_deadline_hours, 0, 24 * 90, 0),
  };
}
