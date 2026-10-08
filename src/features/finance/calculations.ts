import { fromMinor, sumMinor, toMinor } from "@/lib/money";
import type { Invoice } from "./types";
import { isOpenInvoice } from "./status";

/**
 * Pure calculation helpers — no React, no storage. Used by both Today and
 * Finance so the numbers can never drift between screens (§ Calendar
 * follow-up: "Main / Private / Combined должны реально пересчитываться").
 * All sums run in integer minor units (src/lib/money.ts).
 */
export interface RevenueSummary {
  main: number;
  private: number;
  combined: number;
  currency: string;
}

/** Revenue = money actually received. A fully paid invoice counts its amount; a partial one its paid part. */
function receivedMinor(invoice: Invoice): number {
  if (invoice.status === "paid") return toMinor(invoice.amount);
  if (invoice.status === "partial" || invoice.status === "overdue") return toMinor(invoice.paidAmount ?? 0);
  return 0;
}

export function calculateRevenue(invoices: Invoice[], currency = "EUR"): RevenueSummary {
  const main = sumMinor(invoices.filter((i) => i.bucket === "main").map(receivedMinor));
  const privateAmount = sumMinor(invoices.filter((i) => i.bucket === "private").map(receivedMinor));
  return {
    main: fromMinor(main),
    private: fromMinor(privateAmount),
    combined: fromMinor(main + privateAmount),
    currency,
  };
}

/** Still owed: open invoices (not paid, draft or cancelled) minus what was already paid on them. */
export function calculateOutstanding(invoices: Invoice[]): number {
  return fromMinor(
    sumMinor(invoices.filter((i) => isOpenInvoice(i.status)).map((i) => toMinor(i.amount) - toMinor(i.paidAmount ?? 0))),
  );
}
