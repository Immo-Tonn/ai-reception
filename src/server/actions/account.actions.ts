"use server";

import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import type { AuthErrorCode } from "@/server/auth/businessAuth";
import { changePassword } from "@/server/auth/supabaseBusinessAuth";

export type ChangePasswordResult = { ok: true } | { ok: false; code: AuthErrorCode };

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72; // Supabase Auth hashes at most 72 bytes

/**
 * Changes the signed-in owner's password. The CURRENT password is re-checked
 * on the server before the new one is set (an open session alone is not
 * enough); failures come back as stable codes the UI localizes.
 */
export async function changePasswordAction(
  workspaceSlug: string,
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordResult> {
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return { ok: false, code: "invalid_input" };
  }
  if (isDemoWorkspaceSlug(workspaceSlug) || currentPassword === "") {
    return { ok: false, code: "invalid_input" };
  }
  if (newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
    return { ok: false, code: "weak_password" };
  }
  if (newPassword === currentPassword) return { ok: false, code: "invalid_input" };

  try {
    await getSession(workspaceSlug); // must be a signed-in member of this workspace
  } catch {
    return { ok: false, code: "unknown" };
  }
  try {
    return await changePassword(currentPassword, newPassword);
  } catch {
    console.error("[account.actions] change password failed");
    return { ok: false, code: "unknown" };
  }
}
