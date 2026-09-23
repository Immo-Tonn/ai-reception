import type { FinancialBucket, Visibility } from "@/features/appointments/types";

export type InvoiceStatus = "paid" | "unpaid" | "partial";

export interface Invoice {
  id: string;
  number: string;
  client: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  bucket: FinancialBucket;
  /** Independent of `bucket`, same as Appointment/Work — an invoice can
   * be Visibility=PRIVATE with FinancialBucket=MAIN or any other
   * combination (§7.1, §97 non-negotiable requirement #6). */
  visibility: Visibility;
  date: string; // ISO date
}
