import { z } from "zod";

/**
 * Payload the onboarding wizard sends once, at the very end (step 6 —
 * "finish"). See `src/app/onboarding/OnboardingWizard.tsx` for how each
 * field is collected, and `src/server/services/onboarding.service.ts`
 * for what each one is written into.
 */
export const onboardingServiceSchema = z.object({
  name: z.string().min(1).max(200),
  durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
  price: z.coerce.number().min(0).max(1_000_000),
});

export const completeOnboardingSchema = z.object({
  /** Free-text industry slug (e.g. "auto", "beauty") — matches
   * `workspaces.industry`, which has no fixed enum (§ intentionally
   * open-ended, unlike the 4-preset demo `IndustryKey`). */
  industry: z.string().min(1).max(50),
  bookingMode: z.enum(["appointments", "jobs", "projects"]),
  services: z.array(onboardingServiceSchema).max(50).default([]),
  useDefaultHours: z.boolean().default(true),
  includePrivateBucket: z.boolean().default(false),
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
