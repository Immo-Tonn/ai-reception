import { z } from "zod";

/**
 * At least one Unicode letter somewhere, and only letters/combining marks
 * (accents), spaces, hyphens, apostrophes (straight/curly) and dots (for
 * initials like "Anna M.") — no digits or other punctuation. This is what
 * actually rejects "888", "---", "..." while still accepting "Anna
 * Müller", "Jean-Luc", "O'Brien", "Марія" (§ full name validation must not
 * require "first + last name", just reject obvious junk).
 */
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}'’.\-\s]{1,119}$/u;

/** Loose international phone: optional leading "+", digits, spaces,
 * parens, dashes/dots — not tied to any one country's format, but still
 * rejects "abc"/"12"/junk via the digit-count refinement below. */
const PHONE_PATTERN = /^\+?[0-9()\-.\s]{6,20}$/;

export const clientDetailsSchema = z.object({
  name: z.string().trim().regex(NAME_PATTERN),
  email: z.string().trim().toLowerCase().email(),
  phone: z
    .string()
    .trim()
    .regex(PHONE_PATTERN)
    .refine((value) => value.replace(/\D/g, "").length >= 6),
  notes: z.string().trim().max(2000).optional(),
});

export type ClientDetailsInput = z.input<typeof clientDetailsSchema>;
type FieldName = "name" | "email" | "phone";

/** Which fields currently fail validation — the UI decides per field
 * whether to actually show that error (e.g. only after blur/submit), so
 * this returns a plain set rather than baking in any "when to show" UX
 * policy. */
export function getClientDetailsFieldErrors(input: {
  name: string;
  email: string;
  phone: string;
}): Partial<Record<FieldName, true>> {
  const result = clientDetailsSchema.safeParse({ ...input, notes: "" });
  if (result.success) return {};
  const errors: Partial<Record<FieldName, true>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field === "name" || field === "email" || field === "phone") errors[field] = true;
  }
  return errors;
}
