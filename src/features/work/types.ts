import type { FinancialBucket, Visibility } from "@/features/appointments/types";

export type LeadStage = "new" | "contacted" | "quoted" | "won" | "lost";
export type QuoteStatus = "draft" | "sent" | "accepted" | "declined";
export type JobStatus = "scheduled" | "inProgress" | "done" | "invoiced";
export type ProjectStatus = "active" | "onHold" | "done";

interface WorkBase {
  id: string;
  clientName: string;
  title: string;
  notes: string;
  visibility: Visibility;
  financialBucket: FinancialBucket;
  createdAt: string; // ISO date
}

export interface Lead extends WorkBase {
  stage: LeadStage;
  quoteId: string | null;
}

export interface Quote extends WorkBase {
  leadId: string | null;
  amount: number;
  currency: string;
  status: QuoteStatus;
  jobId: string | null;
}

export interface Job extends WorkBase {
  quoteId: string | null;
  amount: number;
  currency: string;
  status: JobStatus;
  invoiceId: string | null;
}

export interface Project extends WorkBase {
  status: ProjectStatus;
}
