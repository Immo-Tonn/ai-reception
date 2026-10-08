import { describe, expect, it } from "vitest";
import { effectiveStatus, isOpenInvoice, statusFromDb, statusToDb } from "../status";
import { calculateOutstanding, calculateRevenue } from "../calculations";
import type { Invoice } from "../types";

describe("status mapping (one definition)", () => {
  it("maps database values to the domain/UI values", () => {
    expect(statusFromDb("draft")).toBe("draft");
    expect(statusFromDb("sent")).toBe("unpaid");
    expect(statusFromDb("partially_paid")).toBe("partial");
    expect(statusFromDb("paid")).toBe("paid");
    expect(statusFromDb("void")).toBe("cancelled");
    expect(statusFromDb("overdue")).toBe("overdue");
    expect(statusFromDb("something-new")).toBe("unpaid");
  });

  it("maps back; overdue is never written (it is 'sent' with a past due date)", () => {
    expect(statusToDb("unpaid")).toBe("sent");
    expect(statusToDb("partial")).toBe("partially_paid");
    expect(statusToDb("cancelled")).toBe("void");
    expect(statusToDb("overdue")).toBe("sent");
    expect(statusToDb("draft")).toBe("draft");
    expect(statusToDb("paid")).toBe("paid");
  });

  it("overdue is derived from the due date and the workspace-local day", () => {
    expect(effectiveStatus("unpaid", "2026-10-01", "2026-10-05")).toBe("overdue");
    expect(effectiveStatus("partial", "2026-10-01", "2026-10-05")).toBe("overdue");
    expect(effectiveStatus("unpaid", "2026-10-05", "2026-10-05")).toBe("unpaid");
    expect(effectiveStatus("unpaid", null, "2026-10-05")).toBe("unpaid");
    expect(effectiveStatus("paid", "2026-10-01", "2026-10-05")).toBe("paid");
    expect(effectiveStatus("cancelled", "2026-10-01", "2026-10-05")).toBe("cancelled");
    expect(effectiveStatus("draft", "2026-10-01", "2026-10-05")).toBe("draft");
  });

  it("only unpaid / partial / overdue count as owed", () => {
    expect(["draft", "unpaid", "partial", "paid", "overdue", "cancelled"].map((s) => isOpenInvoice(s as Invoice["status"]))).toEqual([
      false, true, true, false, true, false,
    ]);
  });
});

const inv = (o: Partial<Invoice>): Invoice => ({
  id: "i", number: "INV-1", client: "A", amount: 100, currency: "EUR", status: "paid", bucket: "main", visibility: "normal", date: "2026-10-01", ...o,
});

describe("calculations with the extended statuses", () => {
  it("revenue = money received: paid counts in full, partial/overdue count the paid part, draft/cancelled nothing", () => {
    const list = [
      inv({ id: "1", status: "paid", amount: 100 }),
      inv({ id: "2", status: "partial", amount: 100, paidAmount: 30 }),
      inv({ id: "3", status: "overdue", amount: 50, paidAmount: 10, bucket: "private" }),
      inv({ id: "4", status: "draft", amount: 999 }),
      inv({ id: "5", status: "cancelled", amount: 999 }),
      inv({ id: "6", status: "unpaid", amount: 999 }),
    ];
    const r = calculateRevenue(list);
    expect(r.main).toBe(130);
    expect(r.private).toBe(10);
    expect(r.combined).toBe(140);
  });

  it("outstanding = open invoices minus what was paid on them (no float drift)", () => {
    const list = [
      inv({ id: "1", status: "unpaid", amount: 0.3 }),
      inv({ id: "2", status: "partial", amount: 0.1, paidAmount: 0.05 }),
      inv({ id: "3", status: "draft", amount: 500 }),
      inv({ id: "4", status: "cancelled", amount: 500 }),
      inv({ id: "5", status: "paid", amount: 500 }),
    ];
    expect(calculateOutstanding(list)).toBe(0.35);
  });
});
