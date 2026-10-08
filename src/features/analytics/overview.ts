import { sumMinor, toMinor } from "@/lib/money";

/**
 * Real-workspace analytics: the shape the `analytics_overview` SQL function (migration 0024) returns,
 * mapped into a typed, browser-safe DTO. Money arrives as exact decimal TEXT and is converted to integer
 * minor units here (src/lib/money.ts); currencies are never mixed. Sections the caller may not see are
 * ABSENT (undefined) - the numbers are not sent to the browser at all.
 *
 * Demo workspaces keep using the pure calculations in ./calculations.ts.
 */

export type BucketKind = "main" | "private" | "custom";

export interface MoneyByCurrency {
  currency: string;
  minor: number;
}

export interface RevenueRow {
  currency: string;
  bucket: BucketKind;
  minor: number;
  payments: number;
}

export interface InvoiceStatusRow {
  status: string;
  currency: string;
  count: number;
  minor: number;
}

export interface OutstandingRow {
  currency: string;
  minor: number;
  invoices: number;
  overdue: number;
}

export interface WorkValueRow {
  status: string;
  currency: string;
  count: number;
  minor: number;
}

export interface AnalyticsOverview {
  range: { from: string; to: string; timezone: string };
  permissions: { appointments: boolean; clients: boolean; finance: boolean; privateBucket: boolean };
  appointments?: {
    total: number;
    byStatus: Record<string, number>;
    services: { serviceId: string | null; name: string | null; count: number }[];
    staff: { staffId: string | null; name: string | null; active: boolean | null; count: number; minutes: number }[];
  };
  newClients?: number;
  work?: {
    leads: { stage: string; count: number }[];
    quotes: WorkValueRow[];
    jobs: WorkValueRow[];
    projects: { status: string; count: number }[];
  };
  finance?: {
    revenue: RevenueRow[];
    invoices: InvoiceStatusRow[];
    outstanding: OutstandingRow[];
  };
}

type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bucketKind = (v: unknown): BucketKind => (v === "private" || v === "custom" ? v : "main");

/**
 * Maps the RPC payload. `canSeePrivateBucket` (from the caller's role) only decides whether the UI offers
 * the Private line; what rows exist is decided by the database (RLS), never by this mapper.
 */
export function mapAnalyticsOverview(raw: unknown, canSeePrivateBucket: boolean): AnalyticsOverview {
  const o = (raw ?? {}) as Raw;
  const range = (o.range ?? {}) as Raw;
  const perm = (o.permissions ?? {}) as Raw;
  const out: AnalyticsOverview = {
    range: { from: str(range.from), to: str(range.to), timezone: str(range.timezone) },
    permissions: {
      appointments: perm.appointments === true,
      clients: perm.clients === true,
      finance: perm.finance === true,
      privateBucket: perm.finance === true && canSeePrivateBucket,
    },
  };

  if (o.appointments && typeof o.appointments === "object") {
    const a = o.appointments as Raw;
    const byStatus: Record<string, number> = {};
    for (const [k, v] of Object.entries((a.by_status ?? {}) as Raw)) byStatus[k] = num(v);
    out.appointments = {
      total: num(a.total),
      byStatus,
      services: arr(a.services).map((s) => ({
        serviceId: typeof s.service_id === "string" ? s.service_id : null,
        name: typeof s.name === "string" ? s.name : null,
        count: num(s.count),
      })),
      staff: arr(a.staff).map((s) => ({
        staffId: typeof s.staff_id === "string" ? s.staff_id : null,
        name: typeof s.name === "string" ? s.name : null,
        active: typeof s.active === "boolean" ? s.active : null,
        count: num(s.count),
        minutes: num(s.minutes),
      })),
    };
  }

  if (o.clients && typeof o.clients === "object") out.newClients = num((o.clients as Raw).new);

  if (o.work && typeof o.work === "object") {
    const w = o.work as Raw;
    const value = (r: Raw): WorkValueRow => ({
      status: str(r.status),
      currency: str(r.currency),
      count: num(r.count),
      minor: toMinor(str(r.total) || "0"),
    });
    out.work = {
      leads: arr(w.leads).map((r) => ({ stage: str(r.stage), count: num(r.count) })),
      quotes: arr(w.quotes).map(value),
      jobs: arr(w.jobs).map(value),
      projects: arr(w.projects).map((r) => ({ status: str(r.status), count: num(r.count) })),
    };
  }

  if (o.finance && typeof o.finance === "object") {
    const f = o.finance as Raw;
    out.finance = {
      revenue: arr(f.revenue).map((r) => ({
        currency: str(r.currency),
        bucket: bucketKind(r.bucket),
        minor: toMinor(str(r.total) || "0"),
        payments: num(r.payments),
      })),
      invoices: arr(f.invoices).map((r) => ({
        status: str(r.status),
        currency: str(r.currency),
        count: num(r.count),
        minor: toMinor(str(r.total) || "0"),
      })),
      outstanding: arr(f.outstanding).map((r) => ({
        currency: str(r.currency),
        minor: toMinor(str(r.total) || "0"),
        invoices: num(r.invoices),
        overdue: num(r.overdue),
      })),
    };
  }
  return out;
}

/** Revenue per currency across the buckets the caller can see (exact integer sums, never mixed currencies). */
export function revenueTotalsByCurrency(rows: readonly RevenueRow[]): MoneyByCurrency[] {
  const byCurrency = new Map<string, number[]>();
  for (const r of rows) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r.minor]);
  return [...byCurrency.entries()].map(([currency, values]) => ({ currency, minor: sumMinor(values) })).sort((a, b) => a.currency.localeCompare(b.currency));
}

/** A rolling period of `days` calendar days ending on `today` (inclusive), all workspace-local. */
export function periodRange(today: string, days: number): { from: string; to: string } {
  const [y, m, d] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - (days - 1)));
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`, to: today };
}
