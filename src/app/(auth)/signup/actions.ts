"use server";

import { redirect } from "next/navigation";
import { getBusinessAuth } from "@/server/auth/supabaseBusinessAuth";
import { signUpOwner } from "@/server/services/provisioning.service";
import { getRequestLocale } from "@/lib/i18n/next";
import type { AuthErrorCode } from "@/server/auth/businessAuth";
import { authAttemptAllowed } from "@/server/auth/authRateLimit";

export interface SignupState {
  error?: Exclude<AuthErrorCode, "email_taken">;
  /** Neutral "check your e-mail" screen — identical for new and already-registered addresses. */
  checkEmail?: boolean;
}

/**
 * Business sign-up. Validation, Auth user creation and atomic workspace
 * provisioning live in `provisioning.service`; this action only reads the
 * form and navigates. Errors go back as a CODE (localized by the form).
 */
export async function signUpOwnerAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  if (!(await authAttemptAllowed({ kind: "sign_up" }))) return { error: "rate_limited" };
  const result = await signUpOwner(
    getBusinessAuth(),
    {
      businessName: formData.get("businessName"),
      email: formData.get("email"),
      password: formData.get("password"),
    },
    await getRequestLocale(),
  );
  if (!result.ok) return { error: result.code };
  if (result.outcome === "check_email") return { checkEmail: true };
  redirect(`/onboarding/${result.workspaceSlug}`);
}
