import { describe, expect, it, vi } from "vitest";

// If anything in the demo path touches Supabase, these blow up.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    throw new Error("Supabase must not be used for demo workspaces");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "serviceos_demo_role" ? { value: "staff" } : undefined) }),
}));

const { getSession } = await import("../session");
const { WorkspaceAccessError } = await import("../resolveSession");

describe("getSession", () => {
  it("demo workspaces use the demo identity and never touch Supabase", async () => {
    await expect(getSession("demo-salon")).resolves.toEqual({ userId: "demo-user", workspaceId: "demo-salon", role: "staff" });
  });

  it("a real workspace without Supabase configured is simply inaccessible — no crash", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    await expect(getSession("some-real-salon")).rejects.toBeInstanceOf(WorkspaceAccessError);
  });
});
