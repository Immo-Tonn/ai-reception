import { describe, expect, it } from "vitest";
import { calculateRevenue, calculateOutstanding } from "../calculations";
import type { Invoice } from "../types";

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
    date: "2026-09-22",
    ...overrides,
  };
}

describe("calculateRevenue", () => {
  it("sums paid invoices separately per bucket and combines them", () => {
    const invoices = [
      makeInvoice({ id: "i1", amount: 100, bucket: "main", status: "paid" }),
      makeInvoice({ id: "i2", amount: 50, bucket: "main", status: "paid" }),
      makeInvoice({ id: "i3", amount: 30, bucket: "private", status: "paid" }),
    ];
    const revenue = calculateRevenue(invoices);
    expect(revenue.main).toBe(150);
    expect(revenue.private).toBe(30);
    expect(revenue.combined).toBe(180);
  });

  it("excludes unpaid and partially-paid invoices from revenue", () => {
    const invoices = [
      makeInvoice({ id: "i1", amount: 100, status: "paid" }),
      makeInvoice({ id: "i2", amount: 200, status: "unpaid" }),
      makeInvoice({ id: "i3", amount: 300, status: "partial" }),
    ];
    expect(calculateRevenue(invoices).combined).toBe(100);
  });

  it("recomputes from scratch — no hidden accumulation between calls", () => {
    const first = calculateRevenue([makeInvoice({ amount: 100 })]);
    const second = calculateRevenue([makeInvoice({ amount: 100 }), makeInvoice({ id: "i2", amount: 50 })]);
    expect(first.combined).toBe(100);
    expect(second.combined).toBe(150);
  });
});

describe("calculateOutstanding", () => {
  it("sums every invoice that is not fully paid", () => {
    const invoices = [
      makeInvoice({ id: "i1", amount: 100, status: "paid" }),
      makeInvoice({ id: "i2", amount: 200, status: "unpaid" }),
      makeInvoice({ id: "i3", amount: 30, status: "partial" }),
    ];
    expect(calculateOutstanding(invoices)).toBe(230);
  });
});
