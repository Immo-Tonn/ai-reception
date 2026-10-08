import { z } from "zod";
import { financialBucketSchema, visibilitySchema } from "./appointment.schema";

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const uuidLike = z.string().max(64);

/** At most two decimals (money is exact in the database; no floating-point arithmetic happens in TypeScript). */
const money = z
  .number()
  .finite()
  .min(0)
  .max(9_999_999_999)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, "At most 2 decimals");
const currency = z.string().regex(/^[A-Z]{3}$/);

const base = {
  /** Free-text prospect name, or the name of the picked client (the server re-reads it from `clientId`). */
  clientName: z.string().trim().max(200).default(""),
  clientId: uuidLike.nullable().optional(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000).default(""),
  visibility: visibilitySchema.default("normal"),
  financialBucket: financialBucketSchema.default("main"),
  financialBucketId: uuidLike.optional(),
};

export const leadStageSchema = z.enum(["new", "contacted", "quoted", "won", "lost"]);
export const quoteStatusSchema = z.enum(["draft", "sent", "accepted", "declined"]);
export const jobStatusSchema = z.enum(["scheduled", "inProgress", "done", "invoiced", "cancelled"]);
export const projectStatusSchema = z.enum(["active", "onHold", "done"]);

export const quoteItemSchema = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().finite().positive().max(99_999_999).refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6),
  unitPrice: money,
});

export const createLeadSchema = z.object({
  ...base,
  source: z.string().trim().max(100).default(""),
  estimatedValue: money.nullable().optional(),
  currency: currency.default("EUR"),
});
export const createQuoteSchema = z.object({
  ...base,
  amount: money.default(0),
  currency: currency.default("EUR"),
  validUntil: dateSchema.nullable().optional(),
  items: z.array(quoteItemSchema).max(100).optional(),
});
export const createJobSchema = z.object({
  ...base,
  amount: money.default(0),
  currency: currency.default("EUR"),
  projectId: uuidLike.nullable().optional(),
  staffId: uuidLike.nullable().optional(),
  startsOn: dateSchema.nullable().optional(),
  dueOn: dateSchema.nullable().optional(),
});
export const createProjectSchema = z.object({
  ...base,
  startsOn: dateSchema.nullable().optional(),
  endsOn: dateSchema.nullable().optional(),
});

// Update schemas deliberately carry NO defaults: zod 4 applies a default inside `.partial()`, which would
// silently overwrite untouched fields (visibility, notes, ...) on every edit.
const baseUpdate = {
  clientName: z.string().trim().max(200),
  clientId: uuidLike.nullable(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().max(4000),
  visibility: visibilitySchema,
  financialBucket: financialBucketSchema,
  financialBucketId: uuidLike,
};
export const updateLeadSchema = z
  .object({ ...baseUpdate, stage: leadStageSchema, source: z.string().trim().max(100), estimatedValue: money.nullable(), currency })
  .partial();
export const updateQuoteSchema = z
  .object({
    ...baseUpdate,
    status: quoteStatusSchema,
    amount: money,
    currency,
    validUntil: dateSchema.nullable(),
    items: z.array(quoteItemSchema).max(100),
  })
  .partial();
export const updateJobSchema = z
  .object({
    ...baseUpdate,
    status: jobStatusSchema,
    amount: money,
    currency,
    projectId: uuidLike.nullable(),
    staffId: uuidLike.nullable(),
    startsOn: dateSchema.nullable(),
    dueOn: dateSchema.nullable(),
  })
  .partial();
export const updateProjectSchema = z
  .object({ ...baseUpdate, status: projectStatusSchema, startsOn: dateSchema.nullable(), endsOn: dateSchema.nullable() })
  .partial();

/** Conversion overrides; absent = copy visibility / bucket from the source. */
export const conversionOverridesSchema = z
  .object({ visibility: visibilitySchema.optional(), financialBucketId: uuidLike.optional() })
  .default({});

export type CreateLeadInput = z.input<typeof createLeadSchema>;
export type CreateQuoteInput = z.input<typeof createQuoteSchema>;
export type CreateJobInput = z.input<typeof createJobSchema>;
export type CreateProjectInput = z.input<typeof createProjectSchema>;
export type UpdateLeadInput = z.input<typeof updateLeadSchema>;
export type UpdateQuoteInput = z.input<typeof updateQuoteSchema>;
export type UpdateJobInput = z.input<typeof updateJobSchema>;
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;
export type ConversionOverrides = z.input<typeof conversionOverridesSchema>;
