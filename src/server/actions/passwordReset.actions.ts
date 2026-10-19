"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  isRecoveryFlagExpired,
  newRecoveryFlagValue,
  RECOVERY_COOKIE_MAX_AGE_S,
  RECOVERY_FLAG_COOKIE,
} from "@/lib/auth/recoveryFlag";
import type { AuthErrorCode } from "@/server/auth/businessAuth";
import {
  completePasswordReset,
  getBusinessAuth,
  getCurrentUserSafe,
  requestPasswordResetCode,
  verifyPasswordResetCode,
} from "@/server/auth/supabaseBusinessAuth";
import { PASSWORD_MAX, PASSWORD_MIN, resetCodeSchema, resetEmailSchema } from "@/server/validation/auth.schema";

/** Stable codes the UI localizes; raw provider messages never reach the browser. */
export type ResetError = AuthErrorCode | "invalid_code" | "same_password" | "password_mismatch";

export interface ResetState {
  error?: ResetError;
  /** The e-mail that was typed, handed back after a failure so the field is not wiped. */
  email?: string;
}

/** Step 1: send a one-time code. The answer never reveals whether the address has an account. */
export async function requestPasswordResetAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const typed = String(formData.get("email") ?? "").trim().slice(0, 254);
  const parsed = resetEmailSchema.safeParse({ email: typed });
  if (!parsed.success) return { error: "invalid_input", email: typed };

  const result = await requestPasswordResetCode(parsed.data.email);
  if (!result.ok) return { error: result.code, email: typed };
  redirect(`/reset-password?email=${encodeURIComponent(parsed.data.email)}`);
}

/** Step 2: check the code. A correct code opens a session and starts the strict window for the new password. */
export async function verifyResetCodeAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const typed = String(formData.get("email") ?? "").trim().slice(0, 254);
  const parsed = resetCodeSchema.safeParse({
    email: typed,
    code: String(formData.get("code") ?? "").replace(/\s+/g, ""),
  });
  if (!parsed.success) return { error: "invalid_code", email: typed };

  const result = await verifyPasswordResetCode(parsed.data.email, parsed.data.code);
  if (!result.ok) return { error: result.code, email: typed };

  (await cookies()).set(RECOVERY_FLAG_COOKIE, newRecoveryFlagValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: RECOVERY_COOKIE_MAX_AGE_S,
  });
  redirect("/reset-password/new");
}

/** Step 3: set the new password inside the window. Success ends every session; the person signs in again. */
export async function setNewPasswordAction(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const store = await cookies();
  const flag = store.get(RECOVERY_FLAG_COOKIE)?.value;
  if (flag === undefined || !(await getCurrentUserSafe())) redirect("/forgot-password");
  if (isRecoveryFlagExpired(flag)) {
    await getBusinessAuth().signOut();
    store.delete(RECOVERY_FLAG_COOKIE);
    redirect("/forgot-password?expired=1");
  }

  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return { error: "weak_password" };
  if (password !== confirm) return { error: "password_mismatch" };

  const result = await completePasswordReset(password);
  if (!result.ok) return { error: result.code };

  store.delete(RECOVERY_FLAG_COOKIE);
  redirect("/login?reset=done");
}

/** Leaves the reset: ends the recovery session and removes the lock. Also the way out after the window ran out. */
export async function cancelPasswordResetAction(): Promise<void> {
  await getBusinessAuth().signOut();
  (await cookies()).delete(RECOVERY_FLAG_COOKIE);
  redirect("/forgot-password");
}
