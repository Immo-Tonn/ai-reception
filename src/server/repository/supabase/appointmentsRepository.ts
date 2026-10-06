import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Repository } from "@/lib/repository/types";
import type {
  Appointment,
  AppointmentStatus,
  FinancialBucket,
  RecurrenceRule,
  Visibility,
} from "@/features/appointments/types";
import { utcToZonedParts, zonedDateTimeToUtc } from "@/lib/date/zoned";
import { getWorkspaceInfo, type WorkspaceInfo } from "./workspaceInfo";
import { isUuid } from "./clientsRepository";

/**
 * Real Supabase-backed Repository<Appointment>.
 *
 * The app's `Appointment` is a denormalized, UI-shaped record (client /
 * service / staff as display names; `date` + `time` as the business's
 * local wall clock). The database is normalized (foreign keys, a single
 * `timestamptz` range). This file is the one translation layer between
 * the two: ids are preferred when the caller supplies them, names are
 * resolved otherwise, and every date/time goes through the workspace's
 * IANA time zone.
 *
 * Not modeled yet for real workspaces: resources (`resourceId` is always
 * null) — see the Track C scope notes.
 */

export class AppointmentConflictError extends Error {
  constructor() {
    super("That time is no longer available. Please pick another slot.");
    this.name = "AppointmentConflictError";
  }
}

const SELECT =
  "id, client_id, service_id, staff_id, starts_at, ends_at, timezone, status, visibility, " +
  "title, client_notes, price, currency, paid, series_id, source, " +
  "clients(name), services(name), staff_profiles(name), " +
  "appointment_series(frequency, interval_days, occurrence_count), financial_buckets(kind)";

interface AppointmentRow {
  id: string;
  client_id: string | null;
  service_id: string | null;
  staff_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: string;
  visibility: string;
  title: string | null;
  client_notes: string;
  price: number | string;
  currency: string;
  paid: boolean;
  series_id: string | null;
  source: NonNullable<Appointment["source"]>;
  clients: { name: string } | null;
  services: { name: string } | null;
  staff_profiles: { name: string } | null;
  appointment_series: {
    frequency: RecurrenceRule["frequency"];
    interval_days: number | null;
    occurrence_count: number;
  } | null;
  financial_buckets: { kind: FinancialBucket } | null;
}

const statusToDb: Record<AppointmentStatus, string> = {
  pending: "pending",
  confirmed: "confirmed",
  checkedIn: "checked_in",
  inProgress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
  noShow: "no_show",
  rescheduled: "rescheduled",
};
const statusFromDb = Object.fromEntries(
  Object.entries(statusToDb).map(([app, db]) => [db, app]),
) as Record<string, AppointmentStatus>;

const visibilityToDb: Record<Visibility, string> = {
  normal: "normal",
  private: "private",
  ownerOnly: "owner_only",
  custom: "custom",
};
const visibilityFromDb = Object.fromEntries(
  Object.entries(visibilityToDb).map(([app, db]) => [db, app]),
) as Record<string, Visibility>;

function fromRow(row: AppointmentRow, info: WorkspaceInfo): Appointment {
  const tz = row.timezone || info.timezone;
  const start = utcToZonedParts(row.starts_at, tz);
  const durationMinutes = Math.round(
    (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60_000,
  );
  const series = row.appointment_series;

  return {
    id: row.id,
    client: row.clients?.name ?? "",
    service: row.services?.name ?? row.title ?? "",
    staff: row.staff_profiles?.name ?? "",
    resourceId: null,
    date: start.date,
    time: start.time,
    durationMinutes,
    price: Number(row.price),
    currency: row.currency,
    notes: row.client_notes,
    visibility: visibilityFromDb[row.visibility] ?? "normal",
    financialBucket: row.financial_buckets?.kind ?? "main",
    status: statusFromDb[row.status] ?? "pending",
    paid: row.paid,
    seriesId: row.series_id,
    recurrence: series
      ? {
          frequency: series.frequency,
          ...(series.interval_days !== null ? { intervalDays: series.interval_days } : {}),
          count: series.occurrence_count,
        }
      : null,
    clientId: row.client_id,
    serviceId: row.service_id,
    staffId: row.staff_id,
    source: row.source,
  };
}

const cache = new Map<string, Repository<Appointment>>();

export function getSupabaseAppointmentsRepository(workspaceId: string): Repository<Appointment> {
  const cached = cache.get(workspaceId);
  if (cached) return cached;

  const admin = createSupabaseAdminClient();
  const bucketCache = new Map<FinancialBucket, string | null>();

  async function bucketId(kind: FinancialBucket): Promise<string | null> {
    if (bucketCache.has(kind)) return bucketCache.get(kind) ?? null;
    const { data, error } = await admin
      .from("financial_buckets")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("kind", kind)
      .eq("is_archived", false)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const id = (data as { id: string } | null)?.id ?? null;
    if (id) bucketCache.set(kind, id);
    return id;
  }

  async function resolveClientId(item: Pick<Appointment, "client" | "clientId">) {
    if (item.clientId) return item.clientId;
    const name = item.client.trim();
    if (!name) return null;
    const { data, error } = await admin
      .from("clients")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("name", name)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return (data as { id: string }).id;
    const { data: created, error: createError } = await admin
      .from("clients")
      .insert({ workspace_id: workspaceId, name })
      .select("id")
      .single();
    if (createError) throw new Error(createError.message);
    return (created as { id: string }).id;
  }

  async function resolveServiceId(item: Pick<Appointment, "service" | "serviceId">) {
    if (item.serviceId) return item.serviceId;
    if (!item.service) return null;
    const { data, error } = await admin
      .from("services")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("name", item.service)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { id: string } | null)?.id ?? null;
  }

  async function resolveStaffId(item: Pick<Appointment, "staff" | "staffId">) {
    if (item.staffId) return item.staffId;
    if (!item.staff) return null;
    const { data, error } = await admin
      .from("staff_profiles")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("active", true)
      .eq("name", item.staff)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as { id: string } | null)?.id ?? null;
  }

  async function ensureSeries(item: Appointment): Promise<string | null> {
    if (!item.seriesId || !item.recurrence || !isUuid(item.seriesId)) return null;
    const { error } = await admin.from("appointment_series").upsert(
      {
        id: item.seriesId,
        workspace_id: workspaceId,
        frequency: item.recurrence.frequency,
        interval_days: item.recurrence.intervalDays ?? null,
        occurrence_count: item.recurrence.count,
      },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);
    return item.seriesId;
  }

  async function fetchOne(id: string, info: WorkspaceInfo): Promise<Appointment | undefined> {
    const { data, error } = await admin
      .from("appointments")
      .select(SELECT)
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? fromRow(data as unknown as AppointmentRow, info) : undefined;
  }

  function mapWriteError(error: { code?: string; message: string }): Error {
    // 23P01 = exclusion_violation: the no-overlap constraint on
    // (staff_id, time range) rejected a simultaneous booking.
    if (error.code === "23P01") return new AppointmentConflictError();
    return new Error(error.message);
  }

  const repo: Repository<Appointment> = {
    async list() {
      const info = await getWorkspaceInfo(workspaceId);
      const { data, error } = await admin
        .from("appointments")
        .select(SELECT)
        .eq("workspace_id", workspaceId)
        .order("starts_at", { ascending: true });
      if (error) throw new Error(error.message);
      return ((data ?? []) as unknown as AppointmentRow[]).map((row) => fromRow(row, info));
    },

    async get(id) {
      const info = await getWorkspaceInfo(workspaceId);
      return fetchOne(id, info);
    },

    async create(item) {
      const info = await getWorkspaceInfo(workspaceId);
      const startsAt = zonedDateTimeToUtc(item.date, item.time, info.timezone);
      const endsAt = new Date(startsAt.getTime() + item.durationMinutes * 60_000);

      const [clientId, serviceId, staffId, financialBucketId, seriesId] = await Promise.all([
        resolveClientId(item),
        resolveServiceId(item),
        resolveStaffId(item),
        bucketId(item.financialBucket),
        ensureSeries(item),
      ]);

      const { data, error } = await admin
        .from("appointments")
        .insert({
          ...(isUuid(item.id) ? { id: item.id } : {}),
          workspace_id: workspaceId,
          client_id: clientId,
          service_id: serviceId,
          staff_id: staffId,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
          timezone: info.timezone,
          status: statusToDb[item.status],
          visibility: visibilityToDb[item.visibility],
          financial_bucket_id: financialBucketId,
          title: serviceId ? null : item.service || null,
          client_notes: item.notes,
          price: item.price,
          currency: item.currency,
          paid: item.paid,
          series_id: seriesId,
          source: item.source ?? "user",
        })
        .select("id")
        .single();
      if (error) throw mapWriteError(error);

      const created = await fetchOne((data as { id: string }).id, info);
      if (!created) throw new Error("Appointment was created but could not be read back.");
      return created;
    },

    async update(id, patch) {
      const info = await getWorkspaceInfo(workspaceId);
      const before = await fetchOne(id, info);
      if (!before) return undefined;
      const merged: Appointment = { ...before, ...patch };

      const row: Record<string, unknown> = {};

      if (
        patch.date !== undefined ||
        patch.time !== undefined ||
        patch.durationMinutes !== undefined
      ) {
        const startsAt = zonedDateTimeToUtc(merged.date, merged.time, info.timezone);
        row.starts_at = startsAt.toISOString();
        row.ends_at = new Date(startsAt.getTime() + merged.durationMinutes * 60_000).toISOString();
        row.timezone = info.timezone;
      }
      if (patch.client !== undefined || patch.clientId !== undefined) {
        row.client_id = await resolveClientId({
          client: merged.client,
          clientId: patch.clientId ?? (patch.client !== undefined ? null : before.clientId),
        });
      }
      if (patch.service !== undefined || patch.serviceId !== undefined) {
        const serviceId = await resolveServiceId({
          service: merged.service,
          serviceId: patch.serviceId ?? (patch.service !== undefined ? null : before.serviceId),
        });
        row.service_id = serviceId;
        row.title = serviceId ? null : merged.service || null;
      }
      if (patch.staff !== undefined || patch.staffId !== undefined) {
        row.staff_id = await resolveStaffId({
          staff: merged.staff,
          staffId: patch.staffId ?? (patch.staff !== undefined ? null : before.staffId),
        });
      }
      if (patch.notes !== undefined) row.client_notes = patch.notes;
      if (patch.status !== undefined) row.status = statusToDb[patch.status];
      if (patch.visibility !== undefined) row.visibility = visibilityToDb[patch.visibility];
      if (patch.financialBucket !== undefined) {
        row.financial_bucket_id = await bucketId(patch.financialBucket);
      }
      if (patch.price !== undefined) row.price = patch.price;
      if (patch.currency !== undefined) row.currency = patch.currency;
      if (patch.paid !== undefined) row.paid = patch.paid;

      if (Object.keys(row).length > 0) {
        row.updated_at = new Date().toISOString();
        const { error } = await admin
          .from("appointments")
          .update(row)
          .eq("workspace_id", workspaceId)
          .eq("id", id);
        if (error) throw mapWriteError(error);
      }
      return fetchOne(id, info);
    },

    async remove(id) {
      const { error } = await admin
        .from("appointments")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async replaceAll() {
      throw new Error("replaceAll is not supported for appointments.");
    },
  };

  cache.set(workspaceId, repo);
  return repo;
}
