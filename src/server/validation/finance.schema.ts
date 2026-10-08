import { z } from "zod";
import { linesTotalMinor } from "@/lib/money";
import { financialBucketSchema, visibilitySchema } from "./appointment.schema";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const uuid = z.string().uuid();

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  /** up to 3 decimals; rounded half-up by src/lib/money.ts */
  quantity: z.number().positive().max(10_000),
  /** major units, 2 decimals */
  unitPrice: z.number().min(0).max(100_000),
});

export const paymentMethodSchema = z.enum(["cash", "bank_transfer", "card", "online", "custom"]);

/** numeric(12,2) holds up to 9,999,999,999.99 */
export const MAX_INVOICE_MINOR = 999_999_999_999;
const itemsFitTotal = (items: { quantity: number; unitPrice: number }[] | undefined) =>
  !items || linesTotalMinor(items) <= MAX_INVOICE_MINOR;

const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Za-z]{3}$/)
  .transform((c) => c.toUpperCase());

export const createInvoiceSchema = z
  .object({
    /** Display name; required unless `clientId` is given (then the client's own name is used). */
    client: z.string().trim().max(200).default(""),
    clientId: uuid.nullish(),
    appointmentId: uuid.nullish(),
    /** Line items. A legacy caller may send only `amount`: it becomes one line. */
    items: z.array(invoiceItemSchema).max(100).optional(),
    amount: z.number().min(0).max(1_000_000_000).optional(),
    currency: currencySchema.optional(),
    bucket: financialBucketSchema,
    financialBucketId: uuid.nullish(),
    visibility: visibilitySchema.default("normal"),
    dueDate: isoDate.nullish(),
    notes: z.string().max(2000).default(""),
    /** `unpaid` = issued (database `sent`). Default: issued. */
    status: z.enum(["draft", "unpaid"]).default("unpaid"),
  })
  .refine((v) => v.client.length > 0 || Boolean(v.clientId), { message: "client or clientId is required", path: ["client"] })
  .refine((v) => itemsFitTotal(v.items), { message: "invoice total too large", path: ["items"] });

export const updateInvoiceSchema = z
  .object({
  id: z.string().min(1),
  client: z.string().trim().max(200).optional(),
  clientId: uuid.nullish(),
  items: z.array(invoiceItemSchema).max(100).optional(),
  bucket: financialBucketSchema.optional(),
  financialBucketId: uuid.nullish(),
  visibility: visibilitySchema.optional(),
  dueDate: isoDate.nullish(),
  notes: z.string().max(2000).optional(),
})
  .refine((v) => itemsFitTotal(v.items), { message: "invoice total too large", path: ["items"] });

/** paid = record a payment for the whole balance; unpaid = void the payments (draft: issue); cancelled = void the invoice. */
export const updateInvoiceStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["paid", "unpaid", "cancelled"]),
});

export const recordPaymentSchema = z.object({
  id: z.string().min(1),
  amount: z.number().positive().max(1_000_000_000),
  method: paymentMethodSchema.default("cash"),
  paidAt: z.string().datetime().optional(),
});

export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.input<typeof updateInvoiceSchema>;
export type UpdateInvoiceStatusInput = z.input<typeof updateInvoiceStatusSchema>;
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;
