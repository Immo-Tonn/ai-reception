import { describe, expect, it } from "vitest";
import {
  getServerAppointmentsRepository,
  getServerAuditLogRepository,
  getServerClientsRepository,
  getServerInvoicesRepository,
  getServerResourcesRepository,
  getServerServicesRepository,
  getServerStaffRepository,
  getServerWaitingListRepository,
  getServerInboxEventsRepository,
} from "../registry";

describe("server repository registry", () => {
  it("demo workspaces keep the in-memory mock", async () => {
    expect((await getServerClientsRepository("demo-salon").list()).length).toBeGreaterThan(0);
    expect((await getServerServicesRepository("demo-salon").list()).length).toBeGreaterThan(0);
  });

  it("a real workspace gets the SHARED (Supabase) repositories, never the in-memory mock", () => {
    const ws = "11111111-2222-4333-8444-555555555555";
    // created lazily: no network, no cookies until a method is called
    for (const make of [getServerAppointmentsRepository, getServerClientsRepository, getServerStaffRepository, getServerResourcesRepository, getServerAuditLogRepository]) {
      const repo = make(ws);
      expect(typeof repo.list).toBe("function");
      expect(repo).not.toBe(make("demo-salon"));
    }
  });

  it("a real workspace's invoices use the Supabase adapter with payment ops; demo keeps the in-memory mock", async () => {
    const real = getServerInvoicesRepository("11111111-2222-4333-8444-555555555555");
    for (const fn of ["list", "get", "create", "update", "recordPayment", "voidPayments", "cancel"] as const) expect(typeof real[fn]).toBe("function");
    await expect(real.remove("x")).rejects.toThrow(/cancel/);
    expect((await getServerInvoicesRepository("demo-salon").list()).length).toBeGreaterThan(0);
  });

  it("a real workspace's waiting list uses the Supabase adapter (never the in-memory mock); inbox events are real-only", () => {
    const real = "11111111-2222-4333-8444-555555555555";
    expect(typeof getServerWaitingListRepository(real).list).toBe("function");
    expect(getServerWaitingListRepository(real)).not.toBe(getServerWaitingListRepository("demo-salon"));
    expect(() => getServerInboxEventsRepository("demo-salon")).toThrow(/not available for demo/);
    expect(typeof getServerInboxEventsRepository(real).list).toBe("function");
  });

  it("a real workspace's services use the Supabase adapter, created lazily without touching the network", () => {
    const repo = getServerServicesRepository("11111111-2222-4333-8444-555555555555");
    expect(typeof repo.list).toBe("function");
  });
});
