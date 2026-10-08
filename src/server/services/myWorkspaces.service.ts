import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";

/** What the business switcher needs about one workspace: the public URL part and the display name. */
export interface MyWorkspace {
  slug: string;
  name: string;
}

/**
 * The workspaces the signed-in business user BELONGS TO (a `workspace_members` row of their own).
 * Runs with the user-scoped client, so Row Level Security applies twice: memberships are only readable for
 * the user themself and `workspaces` only for members. A business that is merely discoverable / bookable
 * by its public link is never part of this list. Not signed in, no membership or any error -> `[]`.
 */
export async function listMyWorkspaces(): Promise<MyWorkspace[]> {
  try {
    const client = await createSupabaseServerClient();
    const { data: auth, error: authError } = await client.auth.getUser(); // verified with the Auth server
    if (authError || !auth.user) return [];

    const { data: memberships, error } = await client.from("workspace_members").select("workspace_id").eq("profile_id", auth.user.id);
    if (error || !memberships || memberships.length === 0) return [];

    const { data: rows, error: wsError } = await client
      .from("workspaces")
      .select("slug,name")
      .in("id", [...new Set(memberships.map((m) => m.workspace_id as string))]);
    if (wsError || !rows) return [];

    return (rows as { slug: string; name: string }[])
      .filter((r) => r.slug && r.name && !isDemoWorkspaceSlug(r.slug))
      .map((r) => ({ slug: r.slug, name: r.name }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  } catch {
    return [];
  }
}
