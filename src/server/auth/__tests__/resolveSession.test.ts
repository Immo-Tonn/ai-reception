import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveWorkspaceSession, UnauthenticatedError, WorkspaceAccessError } from "../resolveSession";

interface Fake {
  user?: { id: string } | null;
  workspace?: { id: string } | null;
  membership?: { role: string } | null;
}

/** Minimal stand-in for the user-scoped client; records the filters used. */
function fakeClient(f: Fake) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: f.user ?? null }, error: f.user ? null : new Error("no") }) },
    from(table: string) {
      const entry = { table, filters: {} as Record<string, unknown> };
      calls.push(entry);
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => ((entry.filters[k] = v), q),
        maybeSingle: async () => ({ data: table === "workspaces" ? (f.workspace ?? null) : (f.membership ?? null) }),
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("resolveWorkspaceSession", () => {
  it("not signed in -> UnauthenticatedError", async () => {
    await expect(resolveWorkspaceSession(fakeClient({ user: null }).client, "x-salon")).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("a workspace RLS does not return (unknown slug or someone else's) -> WorkspaceAccessError", async () => {
    const { client } = fakeClient({ user: { id: "u1" }, workspace: null });
    await expect(resolveWorkspaceSession(client, "someone-elses")).rejects.toBeInstanceOf(WorkspaceAccessError);
  });

  it("no membership row -> WorkspaceAccessError", async () => {
    const { client } = fakeClient({ user: { id: "u1" }, workspace: { id: "w1" }, membership: null });
    await expect(resolveWorkspaceSession(client, "x-salon")).rejects.toBeInstanceOf(WorkspaceAccessError);
  });

  it("an unknown role is denied (default deny), not downgraded", async () => {
    const { client } = fakeClient({ user: { id: "u1" }, workspace: { id: "w1" }, membership: { role: "superadmin" } });
    await expect(resolveWorkspaceSession(client, "x-salon")).rejects.toBeInstanceOf(WorkspaceAccessError);
  });

  it("returns the real workspace id and the member's role, looked up for THIS user only", async () => {
    const { client, calls } = fakeClient({ user: { id: "u1" }, workspace: { id: "w1" }, membership: { role: "manager" } });
    await expect(resolveWorkspaceSession(client, "x-salon")).resolves.toEqual({ userId: "u1", workspaceId: "w1", role: "manager" });
    const membershipCall = calls.find((c) => c.table === "workspace_members")!;
    expect(membershipCall.filters).toEqual({ workspace_id: "w1", profile_id: "u1" });
  });

  it("the error never reveals whether the workspace exists", async () => {
    const a = fakeClient({ user: { id: "u1" }, workspace: null });
    const b = fakeClient({ user: { id: "u1" }, workspace: { id: "w1" }, membership: null });
    const msg = async (c: SupabaseClient) => ((await resolveWorkspaceSession(c, "s").catch((e: Error) => e)) as Error).message;
    expect(await msg(a.client)).toBe(await msg(b.client));
  });
});
