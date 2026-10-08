/**
 * Read-only "Related" panel of the client detail page (real workspaces). Each section is OPTIONAL: a
 * section the viewer may not read is absent, not empty - its data is never sent to the browser.
 */
export interface RelatedWorkItem {
  id: string;
  title: string;
  /** Raw status / stage code; the UI localizes it. */
  status: string;
  /** Quotes and jobs only (integer minor units). */
  amountMinor?: number;
  currency?: string;
}

export interface RelatedInvoice {
  id: string;
  number: string;
  /** Database status, with overdue derived from the workspace-local today. */
  status: string;
  amountMinor: number;
  currency: string;
  issuedAt: string;
}

export interface ClientRelated {
  work?: {
    leads: RelatedWorkItem[];
    quotes: RelatedWorkItem[];
    jobs: RelatedWorkItem[];
    projects: RelatedWorkItem[];
  };
  invoices?: RelatedInvoice[];
}
