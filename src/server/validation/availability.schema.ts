import { z } from "zod";

export const availabilityQuerySchema = z.object({
  serviceId: z.string().min(1),
  staffId: z.string().nullable(), // null = "any available staff"
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const publicBookingSchema = z.object({
  serviceId: z.string().min(1),
  staffId: z.string().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  client: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
    phone: z.string().max(40).default(""),
    notes: z.string().max(1000).default(""),
  }),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type PublicBookingInput = z.infer<typeof publicBookingSchema>;
