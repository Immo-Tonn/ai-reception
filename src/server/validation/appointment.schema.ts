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

const recurrenceSchema = z.object({
  frequency: z.enum(["weekly", "biweekly", "monthly", "custom"]),
  intervalDays: z.number().int().min(1).max(365).optional(),
  count: z.number().int().min(1).max(60),
});

export const createAppointmentSchema = z.object({
  client: z.string().min(1).max(200),
  service: z.string().min(1),
  staff: z.string().min(1),
  /** Stable references. Optional: display names above remain the fallback for demo/legacy callers. */
  clientId: z.string().max(64).optional(),
  serviceId: z.string().max(64).optional(),
  staffId: z.string().max(64).optional(),
  financialBucketId: z.string().max(64).optional(),
  seriesId: z.string().max(64).nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
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
