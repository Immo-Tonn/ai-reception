import "server-only";
import { cookies } from "next/headers";
import { roles, type Role } from "@/server/permissions/roles";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveWorkspaceSession, UnauthenticatedError, WorkspaceAccessError, type Session } from "./resolveSession";

export type { Session };
export { UnauthenticatedError, WorkspaceAccessError };

const DEMO_SESSION_COOKIE = "serviceos_demo_role";

/**
 * Auth abstraction: `getSession()` is the ONLY thing services import to
 * learn who is calling.
 *
 *  - Demo workspaces (the four presets) keep the fixed demo identity whose
 *    role can be switched with a cookie — no Supabase, no login.
 *  - Real workspaces use the signed-in user: identity from Supabase Auth,
 *    workspace + role from the user's own `workspace_members` row, read
 *    under Row Level Security (a user can only ever see their own).
 *
 * `workspaceSlug` is the route param. Unknown / not-yours / not-signed-in
 * are reported as distinct errors, but callers must answer "not found" for
 * a workspace the user cannot access (never confirm it exists).
 */
export async function getSession(workspaceSlug: string): Promise<Session> {
  if (isDemoWorkspaceSlug(workspaceSlug)) {
    const store = await cookies();
    const requested = store.get(DEMO_SESSION_COOKIE)?.value;
    const role: Role = roles.includes(requested as Role) ? (requested as Role) : "owner";
    return { userId: "demo-user", workspaceId: workspaceSlug, role };
  }

  if (!isSupabaseConfigured()) throw new WorkspaceAccessError(workspaceSlug);

  const supabase = await createSupabaseServerClient();
  return resolveWorkspaceSession(supabase, workspaceSlug);
}
