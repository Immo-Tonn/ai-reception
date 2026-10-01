"use server";

import { getSession, UnauthenticatedError, WorkspaceAccessError } from "@/server/auth/session";
import * as onboardingService from "@/server/services/onboarding.service";
import type { CompleteOnboardingInput } from "@/server/validation/onboarding.schema";

export type CompleteOnboardingResult = { ok: true } | { ok: false; error: string };

/**
 * Deliberately does NOT call next/navigation's `redirect()` — this is
 * called imperatively from a client component (`OnboardingWizard`,
 * inside `useTransition`), not bound as a `<form action={...}>`. Mixing
 * `redirect()` with a manual try/catch around the call site is a classic
 * footgun (redirect works by throwing, so a wrapping catch silently
 * swallows the navigation). Returning a plain result and letting the
 * client call `router.push()` on success avoids that entirely.
 */
export async function completeOnboardingAction(
  workspaceSlug: string,
  input: CompleteOnboardingInput,
): Promise<CompleteOnboardingResult> {
  try {
    const session = await getSession(workspaceSlug);
    await onboardingService.completeOnboarding(session, input);
    return { ok: true };
  } catch (error) {
    if (error instanceof UnauthenticatedError || error instanceof WorkspaceAccessError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save onboarding.",
    };
  }
}
