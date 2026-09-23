import { describe, expect, it } from "vitest";
import { computeAnalytics, type AnalyticsFilters } from "../calculations";
import type { Appointment } from "@/features/appointments/types";
import type { Invoice } from "@/features/finance/types";
import type { Lead } from "@/features/work/types";

function makeAppointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: "a1",
    client: "Anna Müller",
    service: "Haircut",
    staff: "Nadia",
    resourceId: null,
    date: "2026-09-20",
    time: "10:00",
    durationMinutes: 45,
    price: 60,
    currency: "EUR",
    notes: "",
    visibility: "normal",
    financialBucket: "main",
    status: "completed",
    paid: true,
    seriesId: null,
    recurrence: null,
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: "i1",
    number: "#1000",
    client: "Anna Müller",
    amount: 100,
    currency: "EUR",
    status: "paid",
    bucket: "main",
    visibility: "normal",
    date: "2026-09-20",
    ...overrides,
  };
}

const baseFilters: AnalyticsFilters = {
  periodDays: 30,
  service: "all",
  staff: "all",
  bucket: "all",
};

describe("computeAnalytics", () => {
  it("counts appointments by status within the period", () => {
    const result = computeAnalytics({
      today: "2026-09-22",
      appointments: [
        makeAppointment({ id: "a1", status: "completed" }),
        makeAppointment({ id: "a2", status: "cancelled" }),
        makeAppointment({ id: "a3", status: "noShow" }),
      ],
      invoices: [],
      leads: [],
      filters: baseFilters,
    });
    expect(result.appointmentsTotal).toBe(3);
    expect(result.completed).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(result.noShow).toBe(1);
  });

  it("excludes appointments outside the selected period", () => {
    const result = computeAnalytics({
      today: "2026-09-22",
      appointments: [
        makeAppointment({ id: "a1", date: "2026-09-20" }),
        makeAppointment({ id: "a2", date: "2026-01-01" }),
      ],
      invoices: [],
      leads: [],
      filters: { ...baseFilters, periodDays: 7 },
    });
    expect(result.appointmentsTotal).toBe(1);
  });

  it("computes average ticket from completed appointments only", () => {
    const result = computeAnalytics({
      today: "2026-09-22",
      appointments: [
        makeAppointment({ id: "a1", status: "completed", price: 100 }),
        makeAppointment({ id: "a2", status: "completed", price: 60 }),
        makeAppointment({ id: "a3", status: "cancelled", price: 500 }),
      ],
      invoices: [],
      leads: [],
      filters: baseFilters,
    });
    expect(result.averageTicket).toBe(80);
  });

  it("classifies clients as new vs returning using full appointment history", () => {
    const result = computeAnalytics({
      today: "2026-09-22",
      appointments: [
        // Returning: had a visit before the 7-day period window.
        makeAppointment({ id: "old", client: "Anna Müller", date: "2026-08-01" }),
        makeAppointment({ id: "a1", client: "Anna Müller", date: "2026-09-20" }),
        // New: first appointment ever falls inside the period.
        makeAppointment({ id: "a2", client: "Jonas Schmidt", date: "2026-09-21" }),
      ],
      invoices: [],
      leads: [],
      filters: { ...baseFilters, periodDays: 7 },
    });
    expect(result.returningClients).toBe(1);
    expect(result.newClients).toBe(1);
  });

  it("derives revenue and outstanding from invoices within the period, split by bucket", () => {
    const result = computeAnalytics({
      today: "2026-09-22",
      appointments: [],
      invoices: [
        makeInvoice({ id: "i1", amount: 100, bucket: "main", status: "paid", date: "2026-09-20" }),
        makeInvoice({ id: "i2", amount: 40, bucket: "private", status: "paid", date: "2026-09-21" }),
        makeInvoice({ id: "i3", amount: 200, status: "unpaid", date: "2026-09-21" }),
        makeInvoice({ id: "i4", amount: 999, date: "2026-01-01" }),
      ],
      leads: [],
      filters: baseFilters,
    });
    expect(result.revenue.main).toBe(100);
    expect(result.revenue.private).toBe(40);
    expect(result.revenue.combined).toBe(140);
    expect(result.outstanding).toBe(200);
  });

  it("ranks popular services and staff utilization by usage", () => {
    const result = computeAnalytics({
      today: "2026-09-22",
      appointments: [
        makeAppointment({ id: "a1", service: "Haircut", staff: "Nadia", durationMinutes: 30 }),
        makeAppointment({ id: "a2", service: "Haircut", staff: "Nadia", durationMinutes: 30 }),
        makeAppointment({ id: "a3", service: "Color", staff: "Mia", durationMinutes: 90 }),
      ],
      invoices: [],
      leads: [],
      filters: baseFilters,
    });
    expect(result.popularServices[0]).toEqual({ service: "Haircut", count: 2 });
    expect(result.staffUtilization.find((s) => s.staff === "Nadia")).toEqual({
      staff: "Nadia",
      count: 2,
      minutes: 60,
    });
  });

  it("computes lead conversion as won vs total leads", () => {
    const leads: Lead[] = [
      { id: "l1", clientName: "A", title: "", notes: "", stage: "won", visibility: "normal", financialBucket: "main", createdAt: "2026-09-01", quoteId: null },
      { id: "l2", clientName: "B", title: "", notes: "", stage: "lost", visibility: "normal", financialBucket: "main", createdAt: "2026-09-01", quoteId: null },
      { id: "l3", clientName: "C", title: "", notes: "", stage: "new", visibility: "normal", financialBucket: "main", createdAt: "2026-09-01", quoteId: null },
    ];
    const result = computeAnalytics({
      today: "2026-09-22",
      appointments: [],
      invoices: [],
      leads,
      filters: baseFilters,
    });
    expect(result.leadConversion).toEqual({ won: 1, total: 3 });
  });

  it("applies service, staff, and bucket filters", () => {
    const result = computeAnalytics({
      today: "2026-09-22",
      appointments: [
        makeAppointment({ id: "a1", service: "Haircut", staff: "Nadia", financialBucket: "main" }),
        makeAppointment({ id: "a2", service: "Color", staff: "Mia", financialBucket: "private" }),
      ],
      invoices: [],
      leads: [],
      filters: { ...baseFilters, service: "Haircut" },
    });
    expect(result.appointmentsTotal).toBe(1);

    const staffFiltered = computeAnalytics({
      today: "2026-09-22",
      appointments: [
        makeAppointment({ id: "a1", staff: "Nadia" }),
        makeAppointment({ id: "a2", staff: "Mia" }),
      ],
      invoices: [],
      leads: [],
      filters: { ...baseFilters, staff: "Mia" },
    });
    expect(staffFiltered.appointmentsTotal).toBe(1);

    const bucketFiltered = computeAnalytics({
      today: "2026-09-22",
      appointments: [
        makeAppointment({ id: "a1", financialBucket: "main" }),
        makeAppointment({ id: "a2", financialBucket: "private" }),
      ],
      invoices: [],
      leads: [],
      filters: { ...baseFilters, bucket: "private" },
    });
    expect(bucketFiltered.appointmentsTotal).toBe(1);
  });
});
