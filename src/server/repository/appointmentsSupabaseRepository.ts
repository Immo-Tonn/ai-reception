import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Repository } from "@/lib/repository/types";
import type { Appointment, FinancialBucket } from "@/features/appointments/types";
import {
  appointmentFromRow,
  instantsFor,
  isUuid,
  maskedAppointmentFromRow,
  recurrenceFromSeries,
  statusToDb,
  visibilityToDb,
  type AppointmentLookups,
  type AppointmentRow,
  type MaskedRow,
  type SeriesRow,
} from "./appointmentsMapper";
import { RepositoryError, RepositoryNotFoundError, toRepositoryError } from "./errors";
import { instantToWall } from "@/lib/time/zonedTime";

/**
 * Supabase adapter for `Repository<Appointment>`; runs as the SIGNED-IN USER
 * so Row Level Security decides what is visible and writable:
 *   - rows the caller may see in full come from `appointments` (policy
 *     `appointments_select`: tenant + `appointments.view` + Visibility);
 *   - rows they may only see as "busy" come from `list_masked_appointments()`
 *     and are returned as neutral placeholders (the service layer masks them).
 * Visibility and Financial Account stay two independent columns/fields.
 *
 * Wall-clock `date`/`time` in the domain are converted with the WORKSPACE's
 * IANA time zone (`workspaces.timezone`); the database stores real instants.
 * A time collision is refused by the exclusion constraints (migration 0011)
 * and surfaces as `RepositoryConflictError`.
 */
export function createSupabaseAppointmentsRepository(
  workspaceId: string,
  getClient: () => Promise<SupabaseClient> = createSupabaseServerClient,
): Repository<Appointment> {
  async function workspaceZone(client: SupabaseClient): Promise<string> {
    const { data, error } = await client.from("workspaces").select("timezone").eq("id", workspaceId).maybeSingle();
    if (error) throw toRepositoryError(error, "appointments.timezone");
    return (data?.timezone as string | undefined) ?? "Europe/Berlin";
  }

  async function loadLookups(client: SupabaseClient): Promise<AppointmentLookups> {
    const [clients, services, staff, buckets, series] = await Promise.all([
      client.from("clients").select("id,name").eq("workspace_id", workspaceId),
      client.from("services").select("id,name").eq("workspace_id", workspaceId),
      client.from("staff_profiles").select("id,name").eq("workspace_id", workspaceId),
      client.rpc("workspace_financial_bucket_kinds", { p_workspace_id: workspaceId }),
      client.from("appointment_series").select("id,frequency,interval_days,occurrence_count").eq("workspace_id", workspaceId),
    ]);
    const pairs = (res: { data: unknown }) => new Map(((res.data as { id: string; name: string }[]) ?? []).map((r) => [r.id, r.name]));
    return {
      clients: pairs(clients),
      services: pairs(services),
      staff: pairs(staff),
      bucketKinds: new Map(((buckets.data as { id: string; kind: string }[]) ?? []).map((b) => [b.id, b.kind as FinancialBucket])),
      series: new Map(((series.data as SeriesRow[]) ?? []).map((s) => [s.id, recurrenceFromSeries(s)])),
    };
  }

  async function resolveId(
    client: SupabaseClient,
    table: "clients" | "services" | "staff_profiles",
    id: string | undefined,
    name: string | undefined,
  ): Promise<string | null> {
    if (isUuid(id)) return id;
    if (!name) return null;
    const { data } = await client.from(table).select("id").eq("workspace_id", workspaceId).eq("name", name).limit(1);
    return ((data as { id: string }[] | null) ?? [])[0]?.id ?? null;
  }

  async function resolveBucket(client: SupabaseClient, kind: FinancialBucket, bucketId?: string): Promise<string> {
    const { data, error } = await client.rpc("resolve_financial_bucket", {
      p_workspace_id: workspaceId,
      p_kind: kind,
      p_bucket_id: isUuid(bucketId) ? bucketId : null,
    });
    if (error || !data) throw toRepositoryError(error ?? { code: "P0002" }, "appointments.bucket");
    return data as string;
  }

  async function ensureSeries(client: SupabaseClient, item: Appointment): Promise<string | null> {
    if (!item.recurrence || !item.seriesId) return null;
    if (isUuid(item.seriesId)) {
      const { data } = await client.from("appointment_series").select("id").eq("workspace_id", workspaceId).eq("id", item.seriesId).maybeSingle();
      if (data) return item.seriesId;
    }
    const { data, error } = await client
      .from("appointment_series")
      .insert({
        workspace_id: workspaceId,
        frequency: item.recurrence.frequency,
        interval_days: item.recurrence.intervalDays ?? null,
        occurrence_count: item.recurrence.count,
      })
      .select("id")
      .single();
    if (error || !data) throw toRepositoryError(error, "appointments.series");
    return (data as { id: string }).id;
  }

  async function getUserId(client: SupabaseClient): Promise<string | null> {
    const { data } = await client.auth.getUser();
    return data.user?.id ?? null;
  }

  return {
    async list() {
      const client = await getClient();
      const [rows, masked, lookups] = await Promise.all([
        client.from("appointments").select("*").eq("workspace_id", workspaceId).order("starts_at", { ascending: true }),
        client.rpc("list_masked_appointments", { p_workspace_id: workspaceId }),
        loadLookups(client),
      ]);
      if (rows.error) throw toRepositoryError(rows.error, "appointments.list");
      if (masked.error) throw toRepositoryError(masked.error, "appointments.list");
      const full = ((rows.data as AppointmentRow[]) ?? []).map((r) => appointmentFromRow(r, lookups));
      const hidden = ((masked.data as MaskedRow[]) ?? []).map((r) => maskedAppointmentFromRow(r, lookups));
      return [...full, ...hidden].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    },

    async get(id) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const [row, lookups] = await Promise.all([
        client.from("appointments").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle(),
        loadLookups(client),
      ]);
      if (row.error) throw toRepositoryError(row.error, "appointments.get");
      if (row.data) return appointmentFromRow(row.data as AppointmentRow, lookups);
      const masked = await client.rpc("list_masked_appointments", { p_workspace_id: workspaceId });
      const hit = ((masked.data as MaskedRow[]) ?? []).find((m) => m.id === id);
      return hit ? maskedAppointmentFromRow(hit, lookups) : undefined;
    },

    async create(item) {
      const client = await getClient();
      const timeZone = await workspaceZone(client);
      const [clientId, serviceId, staffId, financialBucketId, seriesId, userId] = await Promise.all([
        resolveId(client, "clients", item.clientId, item.client),
        resolveId(client, "services", item.serviceId, item.service),
        resolveId(client, "staff_profiles", item.staffId, item.staff),
        resolveBucket(client, item.financialBucket, item.financialBucketId),
        ensureSeries(client, item),
        getUserId(client),
      ]);
      if (!clientId || !serviceId || !staffId) throw new RepositoryNotFoundError("appointments.references");

      const { startsAt, endsAt } = instantsFor(item.date, item.time, item.durationMinutes, timeZone);
      const { data, error } = await client
        .from("appointments")
        .insert({
          workspace_id: workspaceId,
          client_id: clientId,
          service_id: serviceId,
          staff_id: staffId,
          resource_id: item.resourceId,
          starts_at: startsAt,
          ends_at: endsAt,
          timezone: timeZone,
          status: statusToDb(item.status),
          visibility: visibilityToDb(item.visibility),
          financial_bucket_id: financialBucketId,
          client_notes: item.notes,
          price: item.price,
          currency: item.currency,
          paid: item.paid,
          series_id: seriesId,
          source: "user",
          created_by: userId,
        })
        .select("*")
        .single();
      if (error || !data) throw toRepositoryError(error, "appointments.create");
      return appointmentFromRow(data as AppointmentRow, await loadLookups(client));
    },

    async update(id, patch) {
      if (!isUuid(id)) return undefined;
      const client = await getClient();
      const { data: existing, error: readError } = await client
        .from("appointments")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (readError) throw toRepositoryError(readError, "appointments.update");
      if (!existing) return undefined;
      const current = existing as AppointmentRow;

      const row: Record<string, unknown> = {};
      if (patch.status !== undefined) row.status = statusToDb(patch.status);
      if (patch.visibility !== undefined) row.visibility = visibilityToDb(patch.visibility);
      if (patch.notes !== undefined) row.client_notes = patch.notes;
      if (patch.price !== undefined) row.price = patch.price;
      if (patch.currency !== undefined) row.currency = patch.currency;
      if (patch.paid !== undefined) row.paid = patch.paid;
      if (patch.resourceId !== undefined) row.resource_id = patch.resourceId;

      if (patch.staffId !== undefined || patch.staff !== undefined) {
        const staffId = await resolveId(client, "staff_profiles", patch.staffId, patch.staff);
        if (!staffId) throw new RepositoryNotFoundError("appointments.staff");
        row.staff_id = staffId;
      }
      if (patch.serviceId !== undefined || patch.service !== undefined) {
        const serviceId = await resolveId(client, "services", patch.serviceId, patch.service);
        if (!serviceId) throw new RepositoryNotFoundError("appointments.service");
        row.service_id = serviceId;
      }
      if (patch.clientId !== undefined || patch.client !== undefined) {
        const clientId = await resolveId(client, "clients", patch.clientId, patch.client);
        if (!clientId) throw new RepositoryNotFoundError("appointments.client");
        row.client_id = clientId;
      }
      if (patch.financialBucket !== undefined || patch.financialBucketId !== undefined) {
        row.financial_bucket_id = await resolveBucket(client, patch.financialBucket ?? "main", patch.financialBucketId);
      }
      if (patch.date !== undefined || patch.time !== undefined || patch.durationMinutes !== undefined) {
        const wall = instantToWall(current.starts_at, current.timezone);
        const duration = patch.durationMinutes ?? Math.round((new Date(current.ends_at).getTime() - new Date(current.starts_at).getTime()) / 60000);
        const { startsAt, endsAt } = instantsFor(patch.date ?? wall.date, patch.time ?? wall.time, duration, current.timezone);
        row.starts_at = startsAt;
        row.ends_at = endsAt;
      }
      if (Object.keys(row).length === 0) return appointmentFromRow(current, await loadLookups(client));

      const { data, error } = await client
        .from("appointments")
        .update(row)
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) throw toRepositoryError(error, "appointments.update");
      return data ? appointmentFromRow(data as AppointmentRow, await loadLookups(client)) : undefined;
    },

    async remove(id) {
      if (!isUuid(id)) return;
      const client = await getClient();
      const { error } = await client.from("appointments").delete().eq("workspace_id", workspaceId).eq("id", id);
      if (error) throw toRepositoryError(error, "appointments.remove");
    },

    async replaceAll() {
      throw new RepositoryError("appointments.replaceAll is not supported");
    },
  };
}
