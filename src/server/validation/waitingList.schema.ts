import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), "invalid date");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const optionalUuid = z.string().uuid().nullable().optional();

const fields = {
  /** Display / guest name. Required when no client is linked. */
  client: z.string().trim().max(200).default(""),
  clientId: optionalUuid,
  guestPhone: z.string().trim().max(40).default(""),
  guestEmail: z.string().trim().max(200).default(""),
  /** Service display name (demo) — real workspaces send `serviceId`. */
  service: z.string().trim().max(200).default(""),
  serviceId: optionalUuid,
  preferredStaff: z.string().trim().max(200).nullable().optional(),
  preferredStaffId: optionalUuid,
  earliestDate: isoDate,
  latestDate: isoDate,
  preferredDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  preferredTimeStart: hhmm.nullable().optional(),
  preferredTimeEnd: hhmm.nullable().optional(),
  notes: z.string().trim().max(1000).default(""),
};

export const waitingListStatusSchema = z.enum(["waiting", "contacted", "booked", "closed"]);

export const createWaitingListEntrySchema = z
  .object(fields)
  .refine((v) => v.latestDate >= v.earliestDate, { message: "latestDate before earliestDate", path: ["latestDate"] })
  .refine((v) => !v.preferredTimeStart || !v.preferredTimeEnd || v.preferredTimeStart <= v.preferredTimeEnd, {
    message: "time range",
    path: ["preferredTimeEnd"],
  })
  .refine((v) => Boolean(v.clientId) || v.client.length > 0, { message: "client or name required", path: ["client"] })
  .refine((v) => Boolean(v.serviceId) || v.service.length > 0, { message: "service required", path: ["service"] });

export type CreateWaitingListEntryInput = z.input<typeof createWaitingListEntrySchema>;
export type ParsedCreateWaitingListEntry = z.output<typeof createWaitingListEntrySchema>;

export const updateWaitingListEntrySchema = z
  .object({
    // No defaults here: an edit only changes the fields that were sent.
    client: z.string().trim().max(200).optional(),
    clientId: optionalUuid,
    guestPhone: z.string().trim().max(40).optional(),
    guestEmail: z.string().trim().max(200).optional(),
    service: z.string().trim().max(200).optional(),
    serviceId: optionalUuid,
    preferredStaff: fields.preferredStaff,
    preferredStaffId: optionalUuid,
    earliestDate: isoDate.optional(),
    latestDate: isoDate.optional(),
    preferredDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    preferredTimeStart: fields.preferredTimeStart,
    preferredTimeEnd: fields.preferredTimeEnd,
    notes: z.string().trim().max(1000).optional(),
    status: waitingListStatusSchema.optional(),
    bookedAppointmentId: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => !v.earliestDate || !v.latestDate || v.latestDate >= v.earliestDate, { message: "date range", path: ["latestDate"] })
  .refine((v) => !v.preferredTimeStart || !v.preferredTimeEnd || v.preferredTimeStart <= v.preferredTimeEnd, {
    message: "time range",
    path: ["preferredTimeEnd"],
  });

export type UpdateWaitingListEntryInput = z.input<typeof updateWaitingListEntrySchema>;
