import { z } from "zod";

export const createWaitingListEntrySchema = z.object({
  client: z.string().min(1).max(200),
  service: z.string().min(1),
  preferredStaff: z.string().nullable(),
  earliestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  latestDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferredDays: z.array(z.number().int().min(0).max(6)).default([]),
  preferredTimeStart: z.string().nullable(),
  preferredTimeEnd: z.string().nullable(),
});

export type CreateWaitingListEntryInput = z.infer<typeof createWaitingListEntrySchema>;
