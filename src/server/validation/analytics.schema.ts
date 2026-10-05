import { z } from "zod";

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "not a calendar date");

/** Inclusive workspace-local day range. At most 366 days (the SQL function allows 400 as a backstop). */
export const analyticsRangeSchema = z
  .object({ from: isoDay, to: isoDay })
  .refine((r) => r.from <= r.to, { message: "from must not be after to" })
  .refine((r) => (Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / 86_400_000 <= 365, {
    message: "range too long",
  });

export type AnalyticsRangeInput = z.infer<typeof analyticsRangeSchema>;
