import { z } from "zod";

export const visibilitySchema = z.enum(["normal", "private", "ownerOnly", "custom"]);
export const financialBucketSchema = z.enum(["main", "private", "custom"]);
export const appointmentStatusSchema = z.enum([
  "pending",
  "confirmed",
  "checkedIn",
  "inProgress",
  "completed",
  "cancelled",
  "noShow",
  "rescheduled",
]);

const timeSchema = z.string().regex(/^\d{2}:\d{2}$/, "Expected HH:mm");
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createAppointmentSchema = z.object({
  client: z.string().min(1).max(200),
  service: z.string().min(1),
  staff: z.string().min(1),
  resourceId: z.string().nullable(),
  date: dateSchema,
  time: timeSchema,
  durationMinutes: z.number().int().min(5).max(480),
  price: z.number().min(0),
  currency: z.string().length(3),
  notes: z.string().max(2000).default(""),
  visibility: visibilitySchema,
  financialBucket: financialBucketSchema,
  status: appointmentStatusSchema.default("pending"),
  paid: z.boolean().default(false),
});

export const updateAppointmentSchema = createAppointmentSchema.partial();

export const moveAppointmentSchema = z.object({
  id: z.string().min(1),
  date: dateSchema,
  time: timeSchema,
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type MoveAppointmentInput = z.infer<typeof moveAppointmentSchema>;
