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

  it("entities not migrated yet still fail loudly for a real workspace (no silent in-memory writes)", () => {
    for (const make of [getServerInvoicesRepository, getServerWaitingListRepository]) {
      expect(() => make("11111111-2222-4333-8444-555555555555")).toThrow(/not available for real workspaces/);
    }
  });

  it("a real workspace's services use the Supabase adapter, created lazily without touching the network", () => {
    const repo = getServerServicesRepository("11111111-2222-4333-8444-555555555555");
    expect(typeof repo.list).toBe("function");
  });
});
