import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { completeOnboardingSchema, type CompleteOnboardingInput } from "@/server/validation/onboarding.schema";

/**
 * Saves the onboarding wizard's answers by calling `complete_onboarding`
 * (migration 0010): one transaction, runs as the signed-in user under RLS,
 * and a second call is a harmless no-op. Returns `true` if it applied now,
 * `false` if the workspace was already onboarded. Nothing is written in
 * pieces from here, so a failure leaves nothing half-saved.
 */
export async function completeOnboarding(session: Session, input: CompleteOnboardingInput): Promise<boolean> {
  assertCan(session.role, "settings.manage");
  const data = completeOnboardingSchema.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data: applied, error } = await supabase.rpc("complete_onboarding", {
    p_workspace_id: session.workspaceId,
    p_industry: data.industry,
    p_booking_mode: data.bookingMode,
    p_services: data.services,
    p_use_default_hours: data.useDefaultHours,
  });
  if (error) throw new Error("complete_onboarding failed");
  return applied === true;
}
