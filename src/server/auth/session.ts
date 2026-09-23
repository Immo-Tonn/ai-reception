import "server-only";
import { cookies } from "next/headers";
import { roles, type Role } from "@/server/permissions/roles";

/**
 * Auth abstraction. `getSession()` is the ONLY thing services import to
 * find out who's calling — swapping the demo cookie-based session below
 * for real Supabase Auth later means rewriting this one file, not every
 * service (§5 backend foundation: "auth abstraction").
 */
export interface Session {
  userId: string;
  workspaceId: string;
  role: Role;
}

const DEMO_SESSION_COOKIE = "serviceos_demo_role";

/**
 * No real auth yet — the "signed in user" is a fixed demo identity whose
 * role can be swapped via a cookie (useful for permission-matrix
 * testing/QA without building a full login system twice).
 */
export async function getSession(workspaceId: string): Promise<Session> {
  const store = await cookies();
  const requested = store.get(DEMO_SESSION_COOKIE)?.value;
  const role: Role = roles.includes(requested as Role) ? (requested as Role) : "owner";

  return {
    userId: "demo-user",
    workspaceId,
    role,
  };
}
