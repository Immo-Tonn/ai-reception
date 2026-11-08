import { vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Global test wiring for the audit writer (migration 0033: signed-in users cannot
 * insert into audit_logs). The REAL writer logic runs (user, membership, allowlists);
 * only its three dependencies are redirected to the PGlite client of the test:
 * identity and membership come from the test's current user client, the insert is
 * done as the service role of the same database. A test that wants the production
 * wiring calls vi.unmock("@/server/audit/deps").
 */
vi.mock("@/server/audit/deps", async () => {
  const { writeAuditEntry } = await import("@/server/audit/auditWriter");
  const userClient = async (): Promise<SupabaseClient> => {
    const { createSupabaseServerClient } = await import("@/lib/supabase/server");
    return createSupabaseServerClient();
  };
  return {
    recordAuditEntry: (input: Parameters<typeof writeAuditEntry>[0]) =>
      writeAuditEntry(input, {
        async getUserId() {
          const { data, error } = (await (await userClient()).auth.getUser()) as { data: { user: { id: string } | null }; error: unknown };
          return error || !data.user ? null : data.user.id;
        },
        async isWorkspaceMember(workspaceId, userId) {
          const { data, error } = await (await userClient()).from("workspace_members").select("profile_id").eq("workspace_id", workspaceId).eq("profile_id", userId).maybeSingle();
          if (error) throw new Error("membership");
          return Boolean(data);
        },
        async insert(row) {
          const user = (await userClient()) as SupabaseClient & { __asService?: () => SupabaseClient };
          if (!user.__asService) throw new Error("test client has no __asService");
          const { error } = await user.__asService().from("audit_logs").insert(row);
          return error ? { code: (error as { code?: string }).code ?? "insert_failed" } : null;
        },
      }),
  };
});
