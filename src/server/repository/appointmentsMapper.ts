import type {
  Appointment,
  AppointmentStatus,
  FinancialBucket,
  RecurrenceRule,
  Visibility,
} from "@/features/appointments/types";
import { instantToWall, wallToInstant } from "@/lib/time/zonedTime";

/** Row shape of `public.appointments` (the columns the app reads). */
export interface AppointmentRow {
  id: string;
  workspace_id: string;
  client_id: string | null;
  service_id: string | null;
  staff_id: string | null;
  resource_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: string;
  visibility: string;
  financial_bucket_id: string | null;
  client_notes: string;
  price: number | string;
  currency: string;
  paid: boolean;
  series_id: string | null;
}

export interface MaskedRow {
  id: string;
  staff_id: string | null;
  resource_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  status: string;
  visibility: string;
}

export interface SeriesRow {
  id: string;
  frequency: string;
  interval_days: number | null;
  occurrence_count: number;
}

/** Everything needed to turn ids into the display names the UI expects. */
export interface AppointmentLookups {
  clients: Map<string, string>;
  services: Map<string, string>;
  staff: Map<string, string>;
  bucketKinds: Map<string, FinancialBucket>;
  series: Map<string, RecurrenceRule>;
}

const STATUS_FROM_DB: Record<string, AppointmentStatus> = {
  pending: "pending",
  confirmed: "confirmed",
  checked_in: "checkedIn",
  in_progress: "inProgress",
  completed: "completed",
  cancelled: "cancelled",
  no_show: "noShow",
  rescheduled: "rescheduled",
};
const STATUS_TO_DB = Object.fromEntries(Object.entries(STATUS_FROM_DB).map(([db, app]) => [app, db])) as Record<AppointmentStatus, string>;

const VISIBILITY_FROM_DB: Record<string, Visibility> = {
  normal: "normal",
  private: "private",
  owner_only: "ownerOnly",
  custom: "custom",
};
const VISIBILITY_TO_DB: Record<Visibility, string> = {
  normal: "normal",
  private: "private",
  ownerOnly: "owner_only",
  custom: "custom",
};

export const statusToDb = (s: AppointmentStatus) => STATUS_TO_DB[s];
export const visibilityToDb = (v: Visibility) => VISIBILITY_TO_DB[v];
export const statusFromDb = (s: string): AppointmentStatus => STATUS_FROM_DB[s] ?? "pending";
export const visibilityFromDb = (v: string): Visibility => VISIBILITY_FROM_DB[v] ?? "normal";

export function recurrenceFromSeries(series: SeriesRow): RecurrenceRule {
  return {
    frequency: series.frequency as RecurrenceRule["frequency"],
    ...(series.interval_days != null ? { intervalDays: series.interval_days } : {}),
    count: series.occurrence_count,
  };
}

const minutesBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);

/** DB row -> domain `Appointment`. Wall-clock date/time are read in the row's own zone. */
export function appointmentFromRow(row: AppointmentRow, lookups: AppointmentLookups): Appointment {
  const wall = instantToWall(row.starts_at, row.timezone);
  return {
    id: row.id,
    client: row.client_id ? (lookups.clients.get(row.client_id) ?? "") : "",
    ...(row.client_id ? { clientId: row.client_id } : {}),
    service: row.service_id ? (lookups.services.get(row.service_id) ?? "") : "",
    ...(row.service_id ? { serviceId: row.service_id } : {}),
    staff: row.staff_id ? (lookups.staff.get(row.staff_id) ?? "") : "",
    ...(row.staff_id ? { staffId: row.staff_id } : {}),
    resourceId: row.resource_id,
    date: wall.date,
    time: wall.time,
    durationMinutes: minutesBetween(row.starts_at, row.ends_at),
    price: Number(row.price),
    currency: row.currency,
    notes: row.client_notes,
    visibility: visibilityFromDb(row.visibility),
    // A bucket the viewer may not use (e.g. PRIVATE without its permission) is not in
    // `bucketKinds`: shown as the default class and WITHOUT its id, so it cannot be inferred.
    financialBucket: row.financial_bucket_id ? (lookups.bucketKinds.get(row.financial_bucket_id) ?? "main") : "main",
    ...(row.financial_bucket_id && lookups.bucketKinds.has(row.financial_bucket_id) ? { financialBucketId: row.financial_bucket_id } : {}),
    status: statusFromDb(row.status),
    paid: row.paid,
    seriesId: row.series_id,
    recurrence: row.series_id ? (lookups.series.get(row.series_id) ?? null) : null,
  };
}

/**
 * A row the caller may only see as "busy": time, person and resource, nothing
 * else. Filled with neutral placeholders so the domain type stays whole; the
 * service layer's masking (`applyVisibility`) then reduces it to the masked shape.
 */
export function maskedAppointmentFromRow(row: MaskedRow, lookups: AppointmentLookups): Appointment {
  const wall = instantToWall(row.starts_at, row.timezone);
  return {
    id: row.id,
    client: "",
    service: "",
    staff: row.staff_id ? (lookups.staff.get(row.staff_id) ?? "") : "",
    ...(row.staff_id ? { staffId: row.staff_id } : {}),
    resourceId: row.resource_id,
    date: wall.date,
    time: wall.time,
    durationMinutes: minutesBetween(row.starts_at, row.ends_at),
    price: 0,
    currency: "EUR",
    notes: "",
    visibility: visibilityFromDb(row.visibility),
    financialBucket: "main",
    status: statusFromDb(row.status),
    paid: false,
    seriesId: null,
    recurrence: null,
  };
}

/** Domain wall-clock start/end -> instants, in the workspace's zone. */
export function instantsFor(date: string, time: string, durationMinutes: number, timeZone: string) {
  const start = wallToInstant(date, time, timeZone);
  return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + durationMinutes * 60_000).toISOString() };
}

export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
