import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  completeOnboardingSchema,
  type CompleteOnboardingInput,
} from "@/server/validation/onboarding.schema";

/**
 * Persists the onboarding wizard's choices for a freshly-created
 * workspace — the real-data counterpart to what used to be a purely
 * decorative, unwired UI mockup (`router.push("/demo/today")` on
 * finish, nothing saved anywhere). Runs once, right after signup,
 * before the owner ever sees `/[workspaceSlug]/today`.
 *
 * Every write here is scoped to `session.workspaceId` and gated by the
 * same `settings.manage` permission the Services settings page already
 * uses — the wizard is just a friendlier entry point into the same
 * server-side rules, never a way around them.
 */
export async function completeOnboarding(
  session: Session,
  input: CompleteOnboardingInput,
): Promise<void> {
  assertCan(session.role, "settings.manage");
  const data = completeOnboardingSchema.parse(input);
  const admin = createSupabaseAdminClient();

  const { error: workspaceError } = await admin
    .from("workspaces")
    .update({ industry: data.industry, booking_mode: data.bookingMode })
    .eq("id", session.workspaceId);
  if (workspaceError) {
    throw new Error(workspaceError.message);
  }

  if (data.services.length > 0) {
    const serviceRows = data.services.map((service) => ({
      workspace_id: session.workspaceId,
      name: service.name,
      duration_minutes: service.durationMinutes,
      price: service.price,
      currency: "EUR",
    }));
    const { error: servicesError } = await admin.from("services").insert(serviceRows);
    if (servicesError) {
      throw new Error(servicesError.message);
    }
  }

  if (data.useDefaultHours) {
    // Workspace-wide default schedule (staff_id = null — see the
    // `working_hours` table comment in 0002_people_and_catalog.sql).
    // weekday follows JS's Date#getDay() convention: 0 = Sunday.
    const weekdayRows = [1, 2, 3, 4, 5].map((weekday) => ({
      workspace_id: session.workspaceId,
      staff_id: null,
      weekday,
      start_time: "09:00",
      end_time: "18:00",
      is_day_off: false,
    }));
    const weekendRows = [0, 6].map((weekday) => ({
      workspace_id: session.workspaceId,
      staff_id: null,
      weekday,
      start_time: null,
      end_time: null,
      is_day_off: true,
    }));
    const { error: hoursError } = await admin
      .from("working_hours")
      .insert([...weekdayRows, ...weekendRows]);
    if (hoursError) {
      throw new Error(hoursError.message);
    }
  }

  const bucketRows: Array<{
    workspace_id: string;
    name: string;
    slug: string;
    kind: "main" | "private";
    is_default: boolean;
  }> = [
    {
      workspace_id: session.workspaceId,
      name: "Main business",
      slug: "main",
      kind: "main",
      is_default: true,
    },
  ];
  if (data.includePrivateBucket) {
    bucketRows.push({
      workspace_id: session.workspaceId,
      name: "Private",
      slug: "private",
      kind: "private",
      is_default: false,
    });
  }
  const { error: bucketsError } = await admin.from("financial_buckets").insert(bucketRows);
  if (bucketsError) {
    throw new Error(bucketsError.message);
  }
}
