import "server-only";
import type { Session } from "@/server/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class AccountRuleError extends Error {
  constructor(public code: "password_too_short" | "not_owner" | "slug_mismatch", message: string) {
    super(message);
    this.name = "AccountRuleError";
  }
}

const MIN_PASSWORD_LENGTH = 6;

export async function changePassword(newPassword: string): Promise<void> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AccountRuleError("password_too_short", "Password is too short.");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

/**
 * Deletes the business registration: the workspace (every table that
 * references it cascades — services, specialists, hours, clients,
 * appointments, audit log, …) and, when this was the user's only
 * workspace, the login itself (`profiles` follows via its FK to
 * auth.users). Owner only, and the caller must have typed the slug.
 */
export async function deleteRegistration(
  session: Session,
  workspaceSlug: string,
  typedSlug: string,
): Promise<void> {
  if (session.role !== "owner") {
    throw new AccountRuleError("not_owner", "Only the owner can delete the registration.");
  }
  if (typedSlug.trim() !== workspaceSlug) {
    throw new AccountRuleError("slug_mismatch", "Confirmation text does not match.");
  }

  const admin = createSupabaseAdminClient();

  const { error: deleteWorkspaceError } = await admin
    .from("workspaces")
    .delete()
    .eq("id", session.workspaceId);
  if (deleteWorkspaceError) throw new Error(deleteWorkspaceError.message);

  const { count, error: countError } = await admin
    .from("workspace_members")
    .select("workspace_id", { count: "exact", head: true })
    .eq("profile_id", session.userId);
  if (countError) throw new Error(countError.message);

  if ((count ?? 0) === 0) {
    // Remove explicit profile row first (in case the FK cascade from
    // auth.users isn't in place), then the auth user.
    await admin.from("profiles").delete().eq("id", session.userId);
    const { error: authError } = await admin.auth.admin.deleteUser(session.userId);
    if (authError) throw new Error(authError.message);
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut().catch(() => undefined);
}
