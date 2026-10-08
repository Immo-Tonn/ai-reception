import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Repository } from "@/lib/repository/types";
import { WAITING_LIST_STATUSES, type WaitingListEntry, type WaitingListStatus } from "@/features/waitingList/types";
import { isUuid } from "./appointmentsMapper";
import { RepositoryError, toRepositoryError } from "./errors";

export interface WaitingListRow {
  id: string;
  client_id: string | null;
  guest_name: string;
  guest_phone: string;
  guest_email: string;
  service_id: string | null;
  preferred_staff_id: string | null;
  earliest_date: string;
  latest_date: string;
  preferred_days: number[] | null;
  preferred_time_start: string | null;
  preferred_time_end: string | null;
  notes: string;
  status: string;
  booked_appointment_id: string | null;
  created_at: string;
}

const hhmm = (v: string | null) => (v ? String(v).slice(0, 5) : null);
const day = (v: string) => String(v).slice(0, 10);

export function waitingListFromRow(
  row: WaitingListRow,
  serviceNames: Map<string, string>,
  staffNames: Map<string, string>,
): WaitingListEntry {
  const status = (WAITING_LIST_STATUSES as readonly string[]).includes(row.status) ? (row.status as WaitingListStatus) : "waiting";
  return {
    id: row.id,
    client: row.guest_name,
    clientId: row.client_id,
    service: row.service_id ? (serviceNames.get(row.service_id) ?? "") : "",
    serviceId: row.service_id,
    preferredStaff: row.preferred_staff_id ? (staffNames.get(row.preferred_staff_id) ?? null) : null,
    preferredStaffId: row.preferred_staff_id,
    earliestDate: day(row.earliest_date),
    latestDate: day(row.latest_date),
    preferredDays: (row.preferred_days ?? []).map(Number),
    preferredTimeStart: hhmm(row.preferred_time_start),
    preferredTimeEnd: hhmm(row.preferred_time_end),
    guestPhone: row.guest_phone,
    guestEmail: row.guest_email,
    notes: row.notes,
    status,
    bookedAppointmentId: row.booked_appointment_id,
    createdAt: row.created_at,
  };
}

/**
 * Supabase adapter for `Repository<WaitingListEntry>`; runs as the signed-in user (RLS:
 * appointments.view / create / edit, tenant isolation, same-workspace guards). Names for the
 * service and staff are resolved from their ids. Entries are never hard-deleted: `remove` closes them.
 */
export function createSupabaseWaitingListRepository(
  workspaceId: string,
  getClient: () => Promise<SupabaseClient> = createSupabaseServerClient,
): Repository<WaitingListEntry> {
  async function names(client: SupabaseClient) {
    const [services, staff] = await Promise.all([
      client.from("services").select("id,name").eq("workspace_id", workspaceId),
      client.from("staff_profiles").select("id,name").eq("workspace_id", workspaceId),
    ]);
    const map = (r: { data: unknown }) => new Map(((r.data as { id: string; name: string }[]) ?? []).map((x) => [x.id, x.name]));
    return { services: map(services), staff: map(staff) };
  }

  function toColumns(item: Partial<WaitingListEntry>): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    if (item.clientId !== undefined) row.client_id = item.clientId;
    if (item.client !== undefined) row.guest_name = item.clientId ? "" : item.client;
    if (item.guestPhone !== undefined) row.guest_phone = item.guestPhone;
    if (item.guestEmail !== undefined) row.guest_email = item.guestEmail;
    if (item.serviceId !== undefined) row.service_id = item.serviceId;
    if (item.preferredStaffId !== undefined) row.preferred_staff_id = item.preferredStaffId;
    if (item.earliestDate !== undefined) row.earliest_date = item.earliestDate;
    if (item.latestDate !== undefined) row.latest_date = item.latestDate;
    if (item.preferredDays !== undefined) row.preferred_days = item.preferredDays;
    if (item.preferredTimeStart !== undefined) row.preferred_time_start = item.preferredTimeStart;
    if (item.preferredTimeEnd !== undefined) row.preferred_time_end = item.preferredTimeEnd;
    if (item.notes !== undefined) row.notes = item.notes;
    if (item.status !== undefined) row.status = item.status;
    if (item.bookedAppointmentId !== undefined) row.booked_appointment_id = item.bookedAppointmentId;
    return row;
  }

  return {
    async list() {
      const client = await getClient();
      const [rows, n] = await Promise.all([
        client.from("waiting_list").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
        names(client),
      ]);
      if (rows.error) throw toRepositoryError(rows.error, "waitingList.list");
      return ((rows.data as WaitingListRow[]) ?? []).map((r) => waitingListFromRow(r, n.services, n.staff));
    },

    async get(id) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const [row, n] = await Promise.all([
        client.from("waiting_list").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle(),
        names(client),
      ]);
      if (row.error) throw toRepositoryError(row.error, "waitingList.get");
      return row.data ? waitingListFromRow(row.data as WaitingListRow, n.services, n.staff) : undefined;
    },

    async create(item) {
      const client = await getClient();
      const { data: u } = await client.auth.getUser();
      const { data, error } = await client
        .from("waiting_list")
        .insert({ ...toColumns(item), workspace_id: workspaceId, created_by: u.user?.id ?? null })
        .select("*")
        .single();
      if (error || !data) throw toRepositoryError(error, "waitingList.create");
      const n = await names(client);
      return waitingListFromRow(data as WaitingListRow, n.services, n.staff);
    },

    async update(id, patch) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const row = toColumns(patch);
      if (Object.keys(row).length === 0) return this.get(id);
      const { data, error } = await client.from("waiting_list").update(row).eq("workspace_id", workspaceId).eq("id", id).select("*").maybeSingle();
      if (error) throw toRepositoryError(error, "waitingList.update");
      if (!data) return undefined;
      const n = await names(client);
      return waitingListFromRow(data as WaitingListRow, n.services, n.staff);
    },

    async remove(id) {
      // History stays: removing an entry closes it.
      await this.update(id, { status: "closed" });
    },

    async replaceAll() {
      throw new RepositoryError("waitingList.replaceAll is not supported");
    },
  };
}
