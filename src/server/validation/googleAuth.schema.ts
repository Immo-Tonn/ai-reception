import { z } from "zod";

/** Second step of Google sign-up: the person is already signed in, only the business name is asked. */
export const googleSignUpSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
});
