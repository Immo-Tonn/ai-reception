import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/server/auth/session";

let zone: string | null = null;
const created: unknown[] = [];

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: zone ? { timezone: zone } : null }) }) }) }),
  }),
}));
vi.mock("@/server/repository/registry", () => ({
  getServerInvoicesRepository: () => ({ create: async (i: unknown) => void created.push(i), list: async () => [] }),
  getServerAuditLogRepository: () => ({ create: async () => undefined }),
}));

const { createInvoice, getWorkspaceTimeZone } = await import("../finance.service");

const real: Session = { userId: "u", workspaceId: "11111111-0000-4000-8000-000000000001", role: "owner" };
const demo: Session = { userId: "demo-user", workspaceId: "demo-salon", role: "owner" };
const input = { client: "A", amount: 10, currency: "EUR", bucket: "main", visibility: "normal" } as Parameters<typeof createInvoice>[1];
const dateAt = async (s: Session, iso: string) => (await createInvoice(s, input, new Date(iso))).date;

beforeEach(() => {
  zone = "Europe/Berlin";
  created.length = 0;
});

describe("createInvoice default date = workspace-local day", () => {
  it("Berlin: UTC 22:30 on 3 Oct is already 4 Oct", async () => {
    expect(await dateAt(real, "2026-10-03T22:30:00Z")).toBe("2026-10-04");
  });
  it("Berlin: UTC 21:30 on 3 Oct is still 3 Oct (CEST)", async () => {
    expect(await dateAt(real, "2026-10-03T21:30:00Z")).toBe("2026-10-03");
  });
  it("Berlin DST end (25 Oct 2026): 22:30Z 24 Oct = 25 Oct local; 23:30Z 25 Oct = 26 Oct (CET)", async () => {
    expect(await dateAt(real, "2026-10-24T22:30:00Z")).toBe("2026-10-25");
    expect(await dateAt(real, "2026-10-25T22:30:00Z")).toBe("2026-10-25");
    expect(await dateAt(real, "2026-10-25T23:30:00Z")).toBe("2026-10-26");
  });
  it("Berlin DST start (29 Mar 2026): 22:30Z 28 Mar = 28 Mar (CET); 21:30Z 28 Mar... 23:30Z = 29 Mar", async () => {
    expect(await dateAt(real, "2026-03-28T22:30:00Z")).toBe("2026-03-28");
    expect(await dateAt(real, "2026-03-28T23:30:00Z")).toBe("2026-03-29");
    expect(await dateAt(real, "2026-03-29T21:30:00Z")).toBe("2026-03-29");
    expect(await dateAt(real, "2026-03-29T22:30:00Z")).toBe("2026-03-30");
  });
  it("another zone differs correctly (America/New_York)", async () => {
    zone = "America/New_York";
    expect(await dateAt(real, "2026-10-03T22:30:00Z")).toBe("2026-10-03");
    expect(await dateAt(real, "2026-10-04T03:30:00Z")).toBe("2026-10-03");
    expect(await dateAt(real, "2026-10-04T04:30:00Z")).toBe("2026-10-04");
  });
  it("demo workspace has no zone and keeps the browser-local fallback", async () => {
    expect(await getWorkspaceTimeZone(demo)).toBeNull();
    const now = new Date("2026-10-03T22:30:00Z");
    const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(await dateAt(demo, now.toISOString())).toBe(local);
  });
  it("missing/invalid zone falls back, never throws", async () => {
    zone = "Not/AZone";
    expect(await getWorkspaceTimeZone(real)).toBeNull();
    zone = null;
    expect(await getWorkspaceTimeZone(real)).toBeNull();
  });
});
