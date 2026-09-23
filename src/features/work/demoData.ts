import type { Job, Lead, Project, Quote } from "./types";

/** Demo data for the design/navigation pass only — no real client records. */
export const demoLeads: Lead[] = [
  {
    id: "lead-1",
    clientName: "Sofia Bergmann",
    title: "First-time consultation + colour",
    notes: "Found us via Google, asked about walk-in availability.",
    stage: "new",
    visibility: "normal",
    financialBucket: "main",
    createdAt: "2026-09-20",
    quoteId: null,
  },
  {
    id: "lead-2",
    clientName: "Peter Kluge",
    title: "Corporate grooming package (5 staff)",
    notes: "Interested in a recurring monthly booking for their office.",
    stage: "contacted",
    visibility: "normal",
    financialBucket: "main",
    createdAt: "2026-09-17",
    quoteId: null,
  },
];

export const demoQuotes: Quote[] = [
  {
    id: "quote-1",
    leadId: null,
    clientName: "Mia Weber",
    title: "Bridal package — hair + makeup trial",
    notes: "",
    amount: 320,
    currency: "EUR",
    status: "sent",
    visibility: "normal",
    financialBucket: "main",
    createdAt: "2026-09-15",
    jobId: null,
  },
];

export const demoJobs: Job[] = [
  {
    id: "job-1",
    quoteId: null,
    clientName: "Laura Fischer",
    title: "Colour correction — follow-up session",
    notes: "",
    amount: 140,
    currency: "EUR",
    status: "scheduled",
    visibility: "normal",
    financialBucket: "main",
    createdAt: "2026-09-19",
    invoiceId: null,
  },
];

export const demoProjects: Project[] = [
  {
    id: "project-1",
    clientName: "Nordlicht Hotel Spa",
    title: "Quarterly staff training programme",
    notes: "Four sessions across Q4, invoiced monthly.",
    status: "active",
    visibility: "normal",
    financialBucket: "main",
    createdAt: "2026-09-01",
  },
];
