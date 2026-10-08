import { z } from "zod";

export const createServiceSchema = z.object({
  name: z.string().min(1).max(200),
  durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
  price: z.coerce.number().min(0).max(1_000_000),
  currency: z.string().min(1).max(8).default("EUR"),
  bufferBeforeMinutes: z.coerce.number().int().min(0).max(24 * 60).default(0),
  bufferAfterMinutes: z.coerce.number().int().min(0).max(24 * 60).default(0),
  allowedStaffIds: z.array(z.string().uuid()).max(200).default([]),
  description: z.string().trim().max(1000).default(""),
});

export const updateServiceSchema = createServiceSchema
  .extend({
    active: z.boolean(),
    // Empty = every staff member may perform the service.
    allowedStaffIds: z.array(z.string().uuid()).max(200),
  })
  .partial();

export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;
