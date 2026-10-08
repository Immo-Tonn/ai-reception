import { z } from "zod";

/** Supabase hashes with bcrypt, which only reads the first 72 bytes. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

const email = z.string().trim().toLowerCase().email().max(254);

export const signUpSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  email,
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
});

export const signInSchema = z.object({
  email,
  password: z.string().min(1).max(PASSWORD_MAX),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
