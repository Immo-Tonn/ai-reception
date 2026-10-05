import type { FinancialBucket, Visibility } from "@/features/appointments/types";

export type LeadStage = "new" | "contacted" | "quoted" | "won" | "lost";
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";
export type JobStatus = "scheduled" | "inProgress" | "done" | "invoiced" | "cancelled";
export type ProjectStatus = "active" | "onHold" | "done";

export type WorkKind = "lead" | "quote" | "job" | "project";

interface WorkBase {
  id: string;
  /** Display name: the live client name when `clientId` is set, otherwise the free-text prospect name. */
  clientName: string;
  /** Real workspaces: the client row this item belongs to (never duplicated by conversions). */
  clientId?: string | null;
  title: string;
  notes: string;
  /** Independent axis 1. `ownerOnly` / `custom` are preserved on edit even though the simple UI hides them. */
  visibility: Visibility;
  /** Independent axis 2 (class). `financialBucketId` is the exact bucket (also custom ones). */
  financialBucket: FinancialBucket;
  financialBucketId?: string;
  createdAt: string; // ISO date
  archived?: boolean;
}

export interface Lead extends WorkBase {
  stage: LeadStage;
  quoteId: string | null;
  source?: string;
  estimatedValue?: number | null;
  currency?: string;
}

export interface QuoteItem {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Quote extends WorkBase {
  leadId: string | null;
  amount: number;
  currency: string;
  status: QuoteStatus;
  jobId: string | null;
  /** ISO date (workspace-local); past + not accepted/declined = expired (derived, never stored). */
  validUntil?: string | null;
  items?: QuoteItem[];
}

export interface Job extends WorkBase {
  quoteId: string | null;
  amount: number;
  currency: string;
  status: JobStatus;
  invoiceId: string | null;
  /** Number of the linked invoice, when the reader may see it (Finance). */
  invoiceNumber?: string | null;
  projectId?: string | null;
  staffId?: string | null;
  startsOn?: string | null;
  dueOn?: string | null;
}

export interface Project extends WorkBase {
  status: ProjectStatus;
  startsOn?: string | null;
  endsOn?: string | null;
}

/** A quote is expired when its validity date has passed and nobody decided yet. */
export function isQuoteExpired(quote: Pick<Quote, "validUntil" | "status">, today: string): boolean {
  return Boolean(quote.validUntil) && (quote.status === "draft" || quote.status === "sent") && (quote.validUntil as string) < today;
}
