import "server-only";
import { roles, type Role } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Auth abstraction. `getSession()` is the ONLY thing services import to
 * find out who's calling (§5 backend foundation: "auth abstraction").
 *
 * Backed by real Supabase Auth (Этап 0 / Трек A):
 *  - the cookie-bound Supabase client (anon key) tells us WHO is calling
 *    (`auth.getUser()`);
 *  - the `service_role` admin client (which bypasses RLS) tells us WHAT
 *    they're allowed to do (their `workspace_members` row for the given
 *    workspace).
 *
 * `workspaceSlug` is what every existing call site already passes in
 * (the `workspaceSlug` route param — see src/features/workspace/registry.ts,
 * which historically doubled as a mock "workspaceId"). We resolve it to
 * the real `workspaces.id` here so `Session.workspaceId` is a real UUID
 * everywhere downstream, without having to touch every action/page.
 */
export interface Session {
  userId: string;
  workspaceId: string;
  role: Role;
}

export class UnauthenticatedError extends Error {
  constructor(message = "Not signed in.") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export class WorkspaceAccessError extends Error {
  constructor(public workspaceSlug: string) {
    super(`No access to workspace "${workspaceSlug}".`);
    this.name = "WorkspaceAccessError";
  }
}

export async function getSession(workspaceSlug: string): Promise<Session> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new UnauthenticatedError();
  }

  const admin = createSupabaseAdminClient();

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (workspaceError || !workspace) {
    throw new WorkspaceAccessError(workspaceSlug);
  }

  const { data: membership, error: membershipError } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("profile_id", user.id)
    .maybeSingle();

  if (membershipError || !membership) {
    throw new WorkspaceAccessError(workspaceSlug);
  }

  const role: Role = roles.includes(membership.role as Role) ? (membership.role as Role) : "staff";

  return {
    userId: user.id,
    workspaceId: workspace.id,
    role,
  };
}
