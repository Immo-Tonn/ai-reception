import type { SupabaseClient } from "@supabase/supabase-js";
import { roles, type Role } from "@/server/permissions/roles";

export interface Session {
  userId: string;
  workspaceId: string;
  role: Role;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "UnauthenticatedError";
  }
}

export class WorkspaceAccessError extends Error {
  constructor(public workspaceSlug: string) {
    super("No access to this workspace.");
    this.name = "WorkspaceAccessError";
  }
}

/**
 * Pure of Next.js (takes the client), so it is unit-testable with a fake.
 * `client` MUST be the user-scoped client: both lookups below then run
 * under RLS, so a workspace the user is not a member of simply does not
 * come back — an unknown slug and someone else's slug are indistinguishable.
 */
export async function resolveWorkspaceSession(client: SupabaseClient, workspaceSlug: string): Promise<Session> {
  const { data, error } = await client.auth.getUser(); // verified with the Auth server, not just decoded
  if (error || !data.user) throw new UnauthenticatedError();
  const userId = data.user.id;

  const { data: workspace } = await client.from("workspaces").select("id").eq("slug", workspaceSlug).maybeSingle();
  if (!workspace) throw new WorkspaceAccessError(workspaceSlug);

  const { data: membership } = await client
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("profile_id", userId)
    .maybeSingle();
  if (!membership) throw new WorkspaceAccessError(workspaceSlug);

  const role = membership.role as Role;
  if (!roles.includes(role)) throw new WorkspaceAccessError(workspaceSlug); // unknown role = no access (default deny)

  return { userId, workspaceId: workspace.id as string, role };
}
