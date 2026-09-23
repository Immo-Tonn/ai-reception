import { z } from "zod";

export const createClientSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().or(z.literal("")),
  phone: z.string().max(40).default(""),
  tags: z.array(z.enum(["vip", "new"])).default([]),
  notes: z.string().max(2000).default(""),
});

export const updateClientSchema = createClientSchema.partial();

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
