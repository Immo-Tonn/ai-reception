"use server";

import { getSession } from "@/server/auth/session";
import * as accountService from "@/server/services/account.service";

export type AccountActionResult =
  | { ok: true }
  | { ok: false; error: "password_too_short" | "not_owner" | "slug_mismatch" | "generic" };

function toFailure(error: unknown): AccountActionResult {
  if (error instanceof accountService.AccountRuleError) {
    return { ok: false, error: error.code };
  }
  console.error("[account.actions]", error);
  return { ok: false, error: "generic" };
}

export async function changePasswordAction(
  workspaceSlug: string,
  newPassword: string,
): Promise<AccountActionResult> {
  try {
    await getSession(workspaceSlug); // must be a signed-in member
    await accountService.changePassword(newPassword);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}

export async function deleteRegistrationAction(
  workspaceSlug: string,
  typedSlug: string,
): Promise<AccountActionResult> {
  try {
    const session = await getSession(workspaceSlug);
    await accountService.deleteRegistration(session, workspaceSlug, typedSlug);
    return { ok: true };
  } catch (error) {
    return toFailure(error);
  }
}
