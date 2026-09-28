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
 * Business signup: creates a real Supabase Auth user, then (via the
 * service_role admin client, which bypasses RLS) a `profiles` row, a new
 * `workspaces` row, and a `workspace_members` row with role "owner".
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
    return { error: profileError.message };
  }

  const slug = await uniqueSlug(admin, slugify(businessName));

  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .insert({ slug, name: businessName, created_by: userId })
    .select("id, slug")
    .single();
  if (workspaceError || !workspace) {
    return { error: workspaceError?.message ?? "Could not create the workspace." };
  }

  const { error: memberError } = await admin.from("workspace_members").insert({
    workspace_id: workspace.id,
    profile_id: userId,
    role: "owner",
  });
  if (memberError) {
    return { error: memberError.message };
  }

  redirect(`/${workspace.slug}/today`);
}
