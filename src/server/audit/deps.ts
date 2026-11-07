import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAuditEntry, type AuditWriteInput, type AuditWriterDeps } from "./auditWriter";

/**
 * Production wiring for the audit writer. The user is identified and the
 * membership is read with the USER's session (RLS applies); only the final insert
 * uses the service role (audit_logs has no insert privilege for signed-in users
 * since migration 0033). This is the single place that inserts into audit_logs.
 */
function productionDeps(): AuditWriterDeps {
  return {
    async getUserId() {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) return null;
      return data.user.id;
    },
    async isWorkspaceMember(workspaceId, userId) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase
        .from("workspace_members")
        .select("profile_id")
        .eq("workspace_id", workspaceId)
        .eq("profile_id", userId)
        .maybeSingle();
      if (error) throw new Error("membership");
      return Boolean(data);
    },
    async insert(row) {
      const { error } = await createSupabaseAdminClient().from("audit_logs").insert(row);
      return error ? { code: error.code || "insert_failed" } : null;
    },
  };
}

export function recordAuditEntry(input: AuditWriteInput): Promise<void> {
  return writeAuditEntry(input, productionDeps());
}
