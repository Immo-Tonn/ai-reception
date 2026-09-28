"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface LoginState {
  error?: string;
}

export async function signInOwnerAction(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Please enter your email and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user) {
    return { error: "Invalid email or password." };
  }

  const admin = createSupabaseAdminClient();
  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspaces(slug)")
    .eq("profile_id", data.user.id)
    .limit(1)
    .maybeSingle();

  const workspace = membership?.workspaces as { slug: string } | { slug: string }[] | null;
  const slug = Array.isArray(workspace) ? workspace[0]?.slug : workspace?.slug;

  if (!slug) {
    return {
      error: "Signed in, but this account has no workspace yet.",
    };
  }

  redirect(`/${slug}/today`);
}
