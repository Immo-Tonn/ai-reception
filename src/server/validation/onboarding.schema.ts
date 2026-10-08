import { z } from "zod";

/** Payload the onboarding wizard sends once, at its last step. */
export const onboardingServiceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
  price: z.coerce.number().min(0).max(1_000_000),
});

export const completeOnboardingSchema = z.object({
  /** Free-text slug (`workspaces.industry` has no enum — unlike the 4 demo presets). */
  industry: z.string().trim().min(1).max(50),
  bookingMode: z.enum(["appointments", "jobs", "projects"]),
  services: z.array(onboardingServiceSchema).max(50).default([]),
  useDefaultHours: z.boolean().default(true),
});

export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;
