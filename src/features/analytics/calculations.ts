import type { Appointment, FinancialBucket } from "@/features/appointments/types";
import type { Invoice } from "@/features/finance/types";
import type { Lead } from "@/features/work/types";
import { calculateOutstanding, calculateRevenue, type RevenueSummary } from "@/features/finance/calculations";
import { localIsoDate } from "@/lib/date/localIsoDate";

/**
 * Pure, framework-agnostic analytics engine — no React, no storage. Every
 * number is recomputed from the same repository data the other screens
 * use, so Analytics can never drift from Calendar/Finance/Work (same
 * principle as finance/calculations.ts).
 */

export type AnalyticsPeriod = 7 | 30 | 90;

export interface AnalyticsFilters {
  periodDays: AnalyticsPeriod;
  service: string | "all";
  staff: string | "all";
  bucket: FinancialBucket | "all";
}

export interface PopularService {
  service: string;
  count: number;
}

export interface StaffUtilizationEntry {
  staff: string;
  count: number;
  minutes: number;
}

export interface AnalyticsResult {
  revenue: RevenueSummary;
  outstanding: number;
  appointmentsTotal: number;
  completed: number;
  cancelled: number;
  noShow: number;
  newClients: number;
  returningClients: number;
  averageTicket: number;
  popularServices: PopularService[];
  staffUtilization: StaffUtilizationEntry[];
  leadConversion: { won: number; total: number };
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(iso + "T00:00:00");
  date.setDate(date.getDate() + days);
  return localIsoDate(date);
}

export function computeAnalytics(params: {
  today: string; // ISO date, injected so this stays pure/testable
  appointments: Appointment[];
  invoices: Invoice[];
  leads: Lead[];
  filters: AnalyticsFilters;
}): AnalyticsResult {
  const { today, appointments, invoices, leads, filters } = params;
  const periodStart = addDaysIso(today, -filters.periodDays);
  const inPeriod = (date: string) => date >= periodStart && date <= today;

  const filteredAppointments = appointments.filter(
    (a) =>
      inPeriod(a.date) &&
      (filters.service === "all" || a.service === filters.service) &&
      (filters.staff === "all" || a.staff === filters.staff) &&
      (filters.bucket === "all" || a.financialBucket === filters.bucket),
  );

  const filteredInvoices = invoices.filter(
    (i) => inPeriod(i.date) && (filters.bucket === "all" || i.bucket === filters.bucket),
  );

  const revenue = calculateRevenue(filteredInvoices);
  const outstanding = calculateOutstanding(filteredInvoices);

  const completedAppts = filteredAppointments.filter((a) => a.status === "completed");
  const cancelled = filteredAppointments.filter((a) => a.status === "cancelled").length;
  const noShow = filteredAppointments.filter((a) => a.status === "noShow").length;

  const averageTicket = completedAppts.length
    ? completedAppts.reduce((sum, a) => sum + a.price, 0) / completedAppts.length
    : 0;

  const serviceCounts = new Map<string, number>();
  for (const a of filteredAppointments) {
    serviceCounts.set(a.service, (serviceCounts.get(a.service) ?? 0) + 1);
  }
  const popularServices = [...serviceCounts.entries()]
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const staffMap = new Map<string, { count: number; minutes: number }>();
  for (const a of filteredAppointments) {
    const entry = staffMap.get(a.staff) ?? { count: 0, minutes: 0 };
    entry.count += 1;
    entry.minutes += a.durationMinutes;
    staffMap.set(a.staff, entry);
  }
  const staffUtilization = [...staffMap.entries()]
    .map(([staff, value]) => ({ staff, ...value }))
    .sort((a, b) => b.minutes - a.minutes);

  // New vs. returning is judged against the FULL appointment history (not
  // the filtered set) so a service/staff filter never miscounts someone
  // as "new" just because their earlier visit used a different service.
  const clientsInPeriod = new Set(filteredAppointments.map((a) => a.client));
  let newClients = 0;
  let returningClients = 0;
  for (const client of clientsInPeriod) {
    const hadEarlierVisit = appointments.some((a) => a.client === client && a.date < periodStart);
    if (hadEarlierVisit) returningClients += 1;
    else newClients += 1;
  }

  const wonLeads = leads.filter((l) => l.stage === "won").length;

  return {
    revenue,
    outstanding,
    appointmentsTotal: filteredAppointments.length,
    completed: completedAppts.length,
    cancelled,
    noShow,
    newClients,
    returningClients,
    averageTicket,
    popularServices,
    staffUtilization,
    leadConversion: { won: wonLeads, total: leads.length },
  };
}
