"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface SignupState {
  error?: string;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "workspace";
}

async function uniqueSlug(admin: ReturnType<typeof createSupabaseAdminClient>, base: string) {
  let slug = base;
  for (let attempt = 0; attempt < 25; attempt++) {
    const { data: existing } = await admin
      .from("workspaces")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!existing) return slug;
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  throw new Error("Could not allocate a unique workspace slug.");
}

/**
 * Best-effort compensating action for signup's multi-step provisioning:
 * `auth.signUp()` and the `profiles`/`workspaces`/`workspace_members`
 * inserts are separate systems (Supabase Auth vs. Postgres tables via the
 * admin client) and can't share one database transaction. If a later
 * step fails, we delete the auth user we just created rather than leave
 * it behind with no profile/workspace attached — that "orphaned auth
 * user" state is exactly what used to require manual cleanup in the
 * Supabase dashboard after any failed signup attempt.
 *
 * Never throws: a failed rollback must not hide the original error from
 * the person signing up. Worst case without this: the same orphan the
 * app used to leave before this fix existed, not a new failure mode.
 */
async function rollbackAuthUser(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
): Promise<void> {
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    // best-effort — see comment above.
  }
}

/**
 * Business signup: creates a real Supabase Auth user, then (via the
 * service_role admin client, which bypasses RLS) a `profiles` row, a new
 * `workspaces` row, and a `workspace_members` row with role "owner".
 * Each step's failure unwinds everything this attempt created, in
 * reverse order, so a partial failure never leaves a half-provisioned
 * account behind (see `rollbackAuthUser` above).
 *
 * Onboarding (industry/services picker) still doesn't persist anything
 * yet (separate, not-yet-done piece of the plan) — we send the new owner
 * straight to their (empty) real dashboard rather than through a wizard
 * that would discard their answers.
 */
export async function signUpOwnerAction(
  _prevState: SignupState,
  formData: FormData,
): Promise<SignupState> {
  const businessName = String(formData.get("businessName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!businessName || !email || !password) {
    return { error: "Please fill in all fields." };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const supabase = await createSupabaseServerClient();
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (signUpError) {
    return { error: signUpError.message };
  }

  const userId = signUpData.user?.id;
  if (!userId) {
    return { error: "Could not create the user account." };
  }

  const admin = createSupabaseAdminClient();

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: userId, email, full_name: businessName }, { onConflict: "id" });
  if (profileError) {
    await rollbackAuthUser(admin, userId);
    if (profileError.code === "23505") {
      // A `profiles` row for this email already exists under a *different*
      // id — almost always a leftover from an earlier auth user that no
      // longer exists (deleted by hand, or by Supabase itself after a
      // failed signup). Never silently adopt someone else's profile row;
      // ask the person to log in instead, or use a different email.
      return {
        error: "An account with this email already exists. Try logging in instead.",
      };
    }
    return { error: profileError.message };
  }

  const slug = await uniqueSlug(admin, slugify(businessName));

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .insert({ slug, name: businessName, created_by: userId })
    .select("id, slug")
    .single();
  if (workspaceError || !workspace) {
    await admin.from("profiles").delete().eq("id", userId);
    await rollbackAuthUser(admin, userId);
    return { error: workspaceError?.message ?? "Could not create the workspace." };
  }

  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_id: workspace.id,
    profile_id: userId,
    role: "owner",
  });
  if (memberError) {
    await admin.from("workspaces").delete().eq("id", workspace.id);
    await admin.from("profiles").delete().eq("id", userId);
    await rollbackAuthUser(admin, userId);
    return { error: memberError.message };
  }

  // First stop for a brand-new workspace is the onboarding wizard, not
  // the (still empty) dashboard directly — see src/app/onboarding/[workspaceSlug].
  redirect(`/onboarding/${workspace.slug}`);
}
