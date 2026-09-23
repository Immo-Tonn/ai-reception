import { z } from "zod";
import { financialBucketSchema, visibilitySchema } from "./appointment.schema";

export const createInvoiceSchema = z.object({
  client: z.string().min(1).max(200),
  amount: z.number().min(0),
  currency: z.string().length(3).default("EUR"),
  bucket: financialBucketSchema,
  visibility: visibilitySchema.default("normal"),
});

export const updateInvoiceStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["paid", "unpaid", "partial"]),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceStatusInput = z.infer<typeof updateInvoiceStatusSchema>;
