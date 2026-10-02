import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServicesRepository } from "../servicesSupabaseRepository";
import { serviceFromRow, serviceToRow } from "../servicesMapper";

type Call = { table: string; op: string; payload?: unknown; filters: Record<string, unknown> };

/** Records what the repository sends; resolves with canned data. */
function fakeClient(result: { data?: unknown; error?: unknown } = { data: [] }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "", filters: {} };
      calls.push(call);
      const q: Record<string, unknown> = {};
      const chain = () => q;
      Object.assign(q, {
        select: () => ((call.op ||= "select"), q),
        insert: (p: unknown) => ((call.op = "insert"), (call.payload = p), q),
        update: (p: unknown) => ((call.op = "update"), (call.payload = p), q),
        delete: () => ((call.op = "delete"), q),
        eq: (k: string, v: unknown) => ((call.filters[k] = v), q),
        in: (k: string, v: unknown) => ((call.filters[k] = v), q),
        order: chain,
        single: async () => ({ data: Array.isArray(result.data) ? result.data[0] : result.data, error: result.error ?? null }),
        maybeSingle: async () => ({ data: Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null), error: result.error ?? null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: result.data ?? null, error: result.error ?? null }),
      });
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const row = {
  id: "s1", name: "Haircut", duration_minutes: 45, price: "55.50", currency: "EUR",
  buffer_before_minutes: 0, buffer_after_minutes: 10, required_resource_type: null,
  service_staff: [{ staff_id: "st1" }, { staff_id: "st2" }],
};

describe("services mapping", () => {
  it("maps DB rows to the domain model (numeric string -> number, join -> allowedStaffIds)", () => {
    expect(serviceFromRow(row)).toEqual({
      id: "s1", name: "Haircut", durationMinutes: 45, price: 55.5, currency: "EUR",
      bufferBeforeMinutes: 0, bufferAfterMinutes: 10, allowedStaffIds: ["st1", "st2"], requiredResourceType: null,
    });
  });

  it("only maps fields that were provided and never emits workspace_id or id", () => {
    expect(serviceToRow({ name: "X", price: 0 })).toEqual({ name: "X", price: 0 });
    expect(Object.keys(serviceToRow({ id: "evil", name: "X" } as never))).toEqual(["name"]);
  });
});

describe("Supabase services repository", () => {
  const WS = "ws-1";

  it("every query is scoped to the repository's workspace", async () => {
    const { client, calls } = fakeClient({ data: [row] });
    const repo = createSupabaseServicesRepository(WS, async () => client);
    await repo.list();
    await repo.get("s1");
    await repo.update("s1", { name: "New" });
    await repo.remove("s1");
    // (the separate service_staff lookups are keyed by service id, not workspace)
    expect(calls.filter((c) => c.table === "services").map((c) => c.filters.workspace_id)).toEqual([WS, WS, WS, WS]);
  });

  it("create takes the workspace from the repository, ignoring anything the caller supplies", async () => {
    const { client, calls } = fakeClient({ data: [row] });
    const repo = createSupabaseServicesRepository(WS, async () => client);
    await repo.create({ ...serviceFromRow(row), workspace_id: "OTHER-WORKSPACE" } as never);
    const payload = calls.find((c) => c.table === "services")!.payload as Record<string, unknown>;
    expect(payload.workspace_id).toBe(WS);
  });

  it("update cannot move a row to another workspace", async () => {
    const { client, calls } = fakeClient({ data: [row] });
    const repo = createSupabaseServicesRepository(WS, async () => client);
    await repo.update("s1", { name: "N", workspace_id: "OTHER" } as never);
    expect(calls.find((c) => c.table === "services")!.payload).toEqual({ name: "N" });
  });

  it("replaceAll is refused (the old delete-then-insert was non-atomic and destructive)", async () => {
    const { client } = fakeClient();
    await expect(createSupabaseServicesRepository(WS, async () => client).replaceAll([])).rejects.toThrow(/not supported/);
  });

  it("database errors become a generic error (no raw DB text)", async () => {
    const { client } = fakeClient({ data: null, error: { message: "permission denied for table services (db.internal)" } });
    await expect(createSupabaseServicesRepository(WS, async () => client).list()).rejects.toThrow("services.list failed");
  });
});
