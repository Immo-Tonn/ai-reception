import "server-only";
import type { Session } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";
import type { ScheduleMode, StaffRecord } from "@/features/scheduling/types";
import {
  createStaffSchema,
  staffScheduleSchema,
  updateStaffSchema,
  type CreateStaffInput,
  type StaffScheduleInput,
  type UpdateStaffInput,
} from "@/server/validation/scheduling.schema";
import { assertCanRead, assertCanWriteCatalog, audit, nextSortOrder, syncLinks } from "./schedulingShared";
import { replaceWorkingHours } from "./workingHours.service";

/**
 * Staff management (operational schedule people, NOT logins). Permission: `staff.manage`.
 * Staff are archived (`active = false`), never hard deleted: appointments keep their reference
 * (the database also refuses a hard delete of a referenced person). Runs as the signed-in user, so
 * RLS is the second line of defense (tenant isolation + staff.manage).
 */
type Row = {
  id: string;
  name: string;
  title: string | null;
  active: boolean;
  sort_order: number | null;
  color_token: string;
  schedule_mode: string | null;
  profile_id: string | null;
};

const COLUMNS = "id,name,title,active,sort_order,color_token,schedule_mode,profile_id";

function fromRow(row: Row, serviceIds: string[]): StaffRecord {
  return {
    id: row.id,
    name: row.name,
    title: row.title ?? "",
    active: row.active,
    sortOrder: row.sort_order ?? 0,
    colorToken: row.color_token,
    scheduleMode: (row.schedule_mode === "custom" ? "custom" : "inherit") as ScheduleMode,
    serviceIds,
    profileId: row.profile_id,
  };
}

export interface ServiceOption {
  id: string;
  name: string;
  active: boolean;
  requiredResourceType: string | null;
}

/** All staff of the workspace (also inactive), ordered, with the services each one performs. */
export async function listStaffAdmin(session: Session): Promise<StaffRecord[]> {
  assertCanRead(session, "staff.manage");
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("staff_profiles")
    .select(COLUMNS)
    .eq("workspace_id", session.workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw toRepositoryError(error, "staff.list");
  const rows = (data as Row[]) ?? [];
  if (rows.length === 0) return [];
  const { data: links, error: linkError } = await client.from("service_staff").select("service_id,staff_id").in("staff_id", rows.map((r) => r.id));
  if (linkError) throw toRepositoryError(linkError, "staff.links");
  const byStaff = new Map<string, string[]>();
  for (const l of (links as { service_id: string; staff_id: string }[]) ?? []) byStaff.set(l.staff_id, [...(byStaff.get(l.staff_id) ?? []), l.service_id]);
  return rows.map((r) => fromRow(r, byStaff.get(r.id) ?? []));
}

/** Services for the checklists (staff and resource forms). Archived services are kept visible, flagged. */
export async function listServiceOptions(session: Session): Promise<ServiceOption[]> {
  assertCanRead(session, "staff.manage");
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("services")
    .select("id,name,active,required_resource_type")
    .eq("workspace_id", session.workspaceId)
    .order("created_at", { ascending: true });
  if (error) throw toRepositoryError(error, "services.options");
  return ((data as { id: string; name: string; active: boolean; required_resource_type: string | null }[]) ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active,
    requiredResourceType: s.required_resource_type,
  }));
}

async function serviceIdsInWorkspace(session: Session, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("services").select("id").eq("workspace_id", session.workspaceId).in("id", ids);
  if (error) throw toRepositoryError(error, "services.check");
  if (((data as unknown[]) ?? []).length !== ids.length) throw new RepositoryNotFoundError("services.check");
}

export async function getStaff(session: Session, id: string): Promise<StaffRecord> {
  const found = (await listStaffAdmin(session)).find((s) => s.id === id);
  if (!found) throw new RepositoryNotFoundError("staff.get");
  return found;
}

export async function createStaff(session: Session, input: CreateStaffInput): Promise<StaffRecord> {
  assertCanWriteCatalog(session);
  const data = createStaffSchema.parse(input);
  await serviceIdsInWorkspace(session, data.serviceIds);
  const client = await createSupabaseServerClient();
  const sortOrder = data.sortOrder ?? (await nextSortOrder(session, "staff_profiles"));
  const { data: row, error } = await client
    .from("staff_profiles")
    .insert({ workspace_id: session.workspaceId, name: data.name, title: data.title, color_token: data.colorToken, sort_order: sortOrder, schedule_mode: "inherit", active: true })
    .select(COLUMNS)
    .single();
  if (error || !row) throw toRepositoryError(error, "staff.create");
  const created = row as Row;
  try {
    if (data.serviceIds.length > 0) await syncLinks(client, "service_staff", "staff_id", created.id, data.serviceIds, "staff.links");
  } catch (e) {
    // Nothing references a brand-new person yet: undo, so a failed save never leaves a half-created member.
    await client.from("staff_profiles").delete().eq("workspace_id", session.workspaceId).eq("id", created.id);
    throw e;
  }
  await audit(session, "created", "staff", created.id, `Staff added: ${data.name}`);
  return fromRow(created, data.serviceIds);
}

export async function updateStaff(session: Session, id: string, input: UpdateStaffInput): Promise<StaffRecord> {
  assertCanWriteCatalog(session);
  const patch = updateStaffSchema.parse(input);
  const before = await getStaff(session, id); // 404 for another tenant's id (RLS filters it out)
  if (patch.serviceIds) await serviceIdsInWorkspace(session, patch.serviceIds);
  const client = await createSupabaseServerClient();
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.colorToken !== undefined) row.color_token = patch.colorToken;
  if (patch.sortOrder !== undefined) row.sort_order = patch.sortOrder;
  if (Object.keys(row).length > 0) {
    const { data, error } = await client.from("staff_profiles").update(row).eq("workspace_id", session.workspaceId).eq("id", id).select("id").maybeSingle();
    if (error) throw toRepositoryError(error, "staff.update");
    if (!data) throw new RepositoryNotFoundError("staff.update");
  }
  if (patch.serviceIds) await syncLinks(client, "service_staff", "staff_id", id, patch.serviceIds, "staff.links");
  await audit(session, "updated", "staff", id, `Staff updated: ${patch.name ?? before.name}`);
  return getStaff(session, id);
}

/** Archive / restore. Never deletes: history keeps the name. */
export async function setStaffActive(session: Session, id: string, active: boolean): Promise<StaffRecord> {
  assertCanWriteCatalog(session);
  const before = await getStaff(session, id);
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("staff_profiles").update({ active }).eq("workspace_id", session.workspaceId).eq("id", id).select("id").maybeSingle();
  if (error) throw toRepositoryError(error, "staff.setActive");
  if (!data) throw new RepositoryNotFoundError("staff.setActive");
  await audit(session, "updated", "staff", id, `Staff ${active ? "reactivated" : "deactivated"}: ${before.name}`);
  return getStaff(session, id);
}

/**
 * Schedule mode of one person. `inherit` = works the business hours (custom rows are KEPT, so
 * switching back later restores them; they are ignored while inheriting). `custom` replaces the
 * person's weekly intervals first and only then flips the mode, so a rejected schedule never
 * leaves someone in `custom` with no hours.
 */
export async function setStaffSchedule(session: Session, id: string, input: StaffScheduleInput): Promise<StaffRecord> {
  assertCanWriteCatalog(session);
  const data = staffScheduleSchema.parse(input);
  const before = await getStaff(session, id);
  if (data.mode === "custom") await replaceWorkingHours(session, id, data.weekly);
  const client = await createSupabaseServerClient();
  const { data: row, error } = await client.from("staff_profiles").update({ schedule_mode: data.mode }).eq("workspace_id", session.workspaceId).eq("id", id).select("id").maybeSingle();
  if (error) throw toRepositoryError(error, "staff.schedule");
  if (!row) throw new RepositoryNotFoundError("staff.schedule");
  await audit(session, "updated", "workingHours", id, `Working hours of ${before.name}: ${data.mode === "custom" ? "custom schedule" : "business hours"}`);
  return getStaff(session, id);
}
