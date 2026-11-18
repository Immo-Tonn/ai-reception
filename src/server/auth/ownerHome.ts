import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The workspace a signed-in person lands in: owner-owned first, then the oldest membership
 * (the same rule as the password sign-in). Read with the person's own session, so RLS decides
 * what is visible. `null` = no workspace yet.
 */
export async function findOwnerHomeSlug(supabase: Pick<SupabaseClient, "from">, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("workspace_members")
    .select("role, created_at, workspaces(slug)")
    .eq("profile_id", userId)
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as unknown as { role: string; workspaces: { slug: string } | { slug: string }[] | null }[];
  const pick = rows.find((r) => r.role === "owner") ?? rows[0];
  const workspace = Array.isArray(pick?.workspaces) ? pick.workspaces[0] : pick?.workspaces;
  return workspace?.slug ?? null;
}
