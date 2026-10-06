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
  count: z.number().int().min(1).max(100),
});

export const createAppointmentSchema = z.object({
  /** Optional client-generated id (a UUID), so the UI can keep referring
   * to the appointment it just created. */
  id: z.string().uuid().optional(),
  client: z.string().min(1).max(200),
  clientId: z.string().uuid().nullable().optional(),
  serviceId: z.string().uuid().nullable().optional(),
  staffId: z.string().uuid().nullable().optional(),
  seriesId: z.string().uuid().nullable().optional(),
  recurrence: recurrenceSchema.nullable().optional(),
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

// An existing appointment's identity and recurring series can't be
// rewritten through an update.
export const updateAppointmentSchema = createAppointmentSchema
  .omit({ id: true, seriesId: true, recurrence: true })
  .partial();

export const moveAppointmentSchema = z.object({
  id: z.string().min(1),
  date: dateSchema,
  time: timeSchema,
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;
export type MoveAppointmentInput = z.infer<typeof moveAppointmentSchema>;
