"use server";

import { getSession } from "@/server/auth/session";
import * as onboardingService from "@/server/services/onboarding.service";
import { runAction, type ActionResult } from "./result";
import type { CompleteOnboardingInput } from "@/server/validation/onboarding.schema";

/**
 * Returns a plain result (no `redirect()`): the wizard calls this from a
 * client transition and navigates itself on success.
 */
export async function completeOnboardingAction(
  workspaceSlug: string,
  input: CompleteOnboardingInput,
): Promise<ActionResult<{ applied: boolean }>> {
  return runAction(async () => ({
    applied: await onboardingService.completeOnboarding(await getSession(workspaceSlug), input),
  }));
}
