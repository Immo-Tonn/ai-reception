import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const dayRange = z
  .object({ start: time, end: time })
  .refine((r) => r.end > r.start, { message: "end must be after start" })
  .nullable();

/** Seven entries, index 0 = Sunday (Date#getDay()); `null` = day off. */
export const businessHoursSchema = z.array(dayRange).length(7);

export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;
