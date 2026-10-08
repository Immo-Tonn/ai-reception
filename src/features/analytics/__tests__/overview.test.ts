import { describe, expect, it } from "vitest";
import { mapAnalyticsOverview, periodRange, revenueTotalsByCurrency } from "../overview";

describe("mapAnalyticsOverview", () => {
  it("converts decimal text to exact minor units and keeps currencies apart", () => {
    const o = mapAnalyticsOverview(
      {
        range: { from: "2024-10-11", to: "2024-10-11", timezone: "Europe/Berlin" },
        permissions: { appointments: false, clients: false, finance: true },
        finance: {
          revenue: [
            { currency: "EUR", bucket: "main", total: "0.10", payments: 1 },
            { currency: "EUR", bucket: "private", total: "0.20", payments: 1 },
            { currency: "USD", bucket: "main", total: "1234.56", payments: 2 },
          ],
          invoices: [],
          outstanding: [],
        },
      },
      true,
    );
    expect(o.appointments).toBeUndefined();
    expect(o.permissions.privateBucket).toBe(true);
    expect(revenueTotalsByCurrency(o.finance!.revenue)).toEqual([
      { currency: "EUR", minor: 30 }, // 0.10 + 0.20 exactly (no float drift)
      { currency: "USD", minor: 123456 },
    ]);
  });
  it("never offers the private line without finance.view or the private-bucket permission", () => {
    expect(mapAnalyticsOverview({ permissions: { finance: false } }, true).permissions.privateBucket).toBe(false);
    expect(mapAnalyticsOverview({ permissions: { finance: true } }, false).permissions.privateBucket).toBe(false);
  });
  it("omits sections that are absent and tolerates garbage", () => {
    const o = mapAnalyticsOverview(null, false);
    expect(o.finance).toBeUndefined();
    expect(o.work).toBeUndefined();
    expect(o.newClients).toBeUndefined();
  });
});

describe("periodRange", () => {
  it("is an inclusive rolling window ending on the workspace-local today", () => {
    expect(periodRange("2024-10-11", 7)).toEqual({ from: "2024-10-05", to: "2024-10-11" });
    expect(periodRange("2024-03-02", 30)).toEqual({ from: "2024-02-02", to: "2024-03-02" });
  });
});
