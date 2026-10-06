import { z } from "zod";

export const createStaffSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const updateStaffSchema = createStaffSchema.partial();

export type CreateStaffInput = z.infer<typeof createStaffSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
