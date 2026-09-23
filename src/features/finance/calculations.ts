import type { Invoice } from "./types";

/**
 * Pure calculation helpers — no React, no storage. Used by both Today and
 * Finance so the numbers can never drift between screens (§ Calendar
 * follow-up: "Main / Private / Combined должны реально пересчитываться").
 */
export interface RevenueSummary {
  main: number;
  private: number;
  combined: number;
  currency: string;
}

export function calculateRevenue(invoices: Invoice[], currency = "EUR"): RevenueSummary {
  const paid = invoices.filter((i) => i.status === "paid");
  const main = paid.filter((i) => i.bucket === "main").reduce((sum, i) => sum + i.amount, 0);
  const privateAmount = paid
    .filter((i) => i.bucket === "private")
    .reduce((sum, i) => sum + i.amount, 0);
  return { main, private: privateAmount, combined: main + privateAmount, currency };
}

export function calculateOutstanding(invoices: Invoice[]): number {
  return invoices.filter((i) => i.status !== "paid").reduce((sum, i) => sum + i.amount, 0);
}
