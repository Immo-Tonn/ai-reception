"use server";

import { redirect } from "next/navigation";
import { getBusinessAuth } from "@/server/auth/supabaseBusinessAuth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signInSchema } from "@/server/validation/auth.schema";
import type { AuthErrorCode } from "@/server/auth/businessAuth";

export interface LoginState {
  error?: AuthErrorCode | "no_workspace";
}

export async function signInOwnerAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "invalid_credentials" }; // do not hint which field was wrong

  const auth = getBusinessAuth();
  const result = await auth.signInWithPassword(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: result.code };

  // The user's own memberships, read under RLS. Owner-owned workspaces first, then oldest.
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("role, created_at, workspaces(slug)")
    .eq("profile_id", result.userId)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as unknown as { role: string; workspaces: { slug: string } | { slug: string }[] | null }[];
  const pick = rows.find((r) => r.role === "owner") ?? rows[0];
  const workspace = Array.isArray(pick?.workspaces) ? pick.workspaces[0] : pick?.workspaces;
  if (!workspace?.slug) {
    await auth.signOut();
    return { error: "no_workspace" };
  }
  redirect(`/${workspace.slug}/today`);
}
