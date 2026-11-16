"use server";

import { redirect } from "next/navigation";
import { getRequestLocale } from "@/lib/i18n/next";
import { getBusinessAuth, getCurrentUserSafe } from "@/server/auth/supabaseBusinessAuth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { authAttemptAllowed } from "@/server/auth/authRateLimit";
import { findOwnerHomeSlug } from "@/server/auth/ownerHome";
import { provisionOwnerWorkspace } from "@/server/services/provisioning.service";
import { googleSignUpSchema } from "@/server/validation/googleAuth.schema";
import type { AuthErrorCode } from "@/server/auth/businessAuth";

export interface GoogleSignupState {
  error?: AuthErrorCode;
  businessName?: string;
}

/**
 * Finishes a Google sign-up: creates the workspace for the person who is signed in right now.
 * The identity (id, verified e-mail) comes from the session, never from the form. A person who
 * already has a workspace is sent there instead of getting a second one.
 */
export async function completeGoogleSignUpAction(_prev: GoogleSignupState, formData: FormData): Promise<GoogleSignupState> {
  const typed = String(formData.get("businessName") ?? "").trim().slice(0, 120);
  const user = await getCurrentUserSafe();
  if (!user || !user.email) redirect("/login");

  const parsed = googleSignUpSchema.safeParse({ businessName: formData.get("businessName") });
  if (!parsed.success) return { error: "invalid_input", businessName: typed };
  if (!(await authAttemptAllowed({ kind: "sign_up" }))) return { error: "rate_limited", businessName: typed };

  const existing = await findOwnerHomeSlug(await createSupabaseServerClient(), user.id);
  if (existing) redirect(`/${existing}/today`);

  const result = await provisionOwnerWorkspace({
    userId: user.id,
    email: user.email.trim().toLowerCase(),
    businessName: parsed.data.businessName,
    locale: await getRequestLocale(),
  });
  if (!result.ok) return { error: result.code, businessName: typed };
  redirect(`/onboarding/${result.workspaceSlug}`);
}

/** "Use a different account": ends the Google session and returns to the sign-in page. */
export async function cancelGoogleSignUpAction(): Promise<void> {
  await getBusinessAuth().signOut();
  redirect("/login");
}
