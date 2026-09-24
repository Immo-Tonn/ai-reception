"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Icon } from "@/components/ui";
import { useLeads, useQuotes, useJobs, useProjects } from "@/features/work/useWork";
import { useInvoices } from "@/features/finance/useInvoices";
import { useAuditLog } from "@/features/auditLog/useAuditLog";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import type { Lead, LeadStage, Quote, QuoteStatus, Job, JobStatus, Project, ProjectStatus } from "@/features/work/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency } from "@/lib/i18n/format";
import { WorkItemSheet, type WorkItemDraft, type WorkKind } from "./WorkItemSheet";
import styles from "./page.module.css";

type Tab = "leads" | "quotes" | "jobs" | "projects";

export function WorkView({
  workspaceSlug,
  locale,
  messages,
  appointmentMessages,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["work"];
  appointmentMessages: Messages["appointment"];
}) {
  const searchParams = useSearchParams();
  const workspace = getWorkspaceConfig(workspaceSlug);
  const pageTitle = workspace.workLabel?.[locale] ?? messages.title;
  const pageIntro = workspace.workIntro?.[locale];
  const { items: leads, create: createLead, update: updateLead } = useLeads(workspaceSlug);
  const { items: quotes, create: createQuote, update: updateQuote } = useQuotes(workspaceSlug);
  const { items: jobs, create: createJob, update: updateJob } = useJobs(workspaceSlug);
  const { items: projects, create: createProject, update: updateProject } = useProjects(workspaceSlug);
  const { create: createInvoice } = useInvoices(workspaceSlug);
  const { log } = useAuditLog(workspaceSlug);

  const [tab, setTab] = useState<Tab>("leads");
  const [sheetOpen, setSheetOpen] = useState(searchParams.get("create") === "lead");
  const prefillClient = searchParams.get("client") ?? "";

  const kindForTab: Record<Tab, WorkKind> = {
    leads: "lead",
    quotes: "quote",
    jobs: "job",
    projects: "project",
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "leads", label: messages.tabLeads },
    { key: "quotes", label: messages.tabQuotes },
    { key: "jobs", label: messages.tabJobs },
    { key: "projects", label: messages.tabProjects },
  ];

  const leadStageLabel: Record<LeadStage, string> = {
    new: messages.stageNew,
    contacted: messages.stageContacted,
    quoted: messages.stageQuoted,
    won: messages.stageWon,
    lost: messages.stageLost,
  };

  const quoteStatusLabel: Record<QuoteStatus, string> = {
    draft: messages.quoteStatusDraft,
    sent: messages.quoteStatusSent,
    accepted: messages.quoteStatusAccepted,
    declined: messages.quoteStatusDeclined,
  };

  const jobStatusLabel: Record<JobStatus, string> = {
    scheduled: messages.jobStatusScheduled,
    inProgress: messages.jobStatusInProgress,
    done: messages.jobStatusDone,
    invoiced: messages.jobStatusInvoiced,
  };

  const projectStatusLabel: Record<ProjectStatus, string> = {
    active: messages.projectStatusActive,
    onHold: messages.projectStatusOnHold,
    done: messages.projectStatusDone,
  };

  function handleCreate(draft: WorkItemDraft) {
    const base = {
      id: `${kindForTab[tab]}-${Date.now()}`,
      clientName: draft.clientName,
      title: draft.title,
      notes: draft.notes,
      visibility: draft.visibility,
      financialBucket: draft.financialBucket,
      createdAt: new Date().toISOString().slice(0, 10),
    };

    if (tab === "leads") {
      const lead: Lead = { ...base, stage: "new", quoteId: null };
      createLead(lead);
      log({ action: "created", entityType: "lead", entityId: lead.id, summary: `${lead.clientName} · ${lead.title}`, source: "user" });
    } else if (tab === "quotes") {
      const quote: Quote = {
        ...base,
        leadId: null,
        amount: draft.amount,
        currency: "EUR",
        status: "draft",
        jobId: null,
      };
      createQuote(quote);
      log({ action: "created", entityType: "quote", entityId: quote.id, summary: `${quote.clientName} · ${quote.title}`, source: "user" });
    } else if (tab === "jobs") {
      const job: Job = {
        ...base,
        quoteId: null,
        amount: draft.amount,
        currency: "EUR",
        status: "scheduled",
        invoiceId: null,
      };
      createJob(job);
      log({ action: "created", entityType: "job", entityId: job.id, summary: `${job.clientName} · ${job.title}`, source: "user" });
    } else {
      const project: Project = { ...base, status: "active" };
      createProject(project);
      log({ action: "created", entityType: "project", entityId: project.id, summary: `${project.clientName} · ${project.title}`, source: "user" });
    }
  }

  function handleLeadToQuote(lead: Lead) {
    const quote: Quote = {
      id: `quote-${Date.now()}`,
      leadId: lead.id,
      clientName: lead.clientName,
      title: lead.title,
      notes: lead.notes,
      amount: 0,
      currency: "EUR",
      status: "draft",
      visibility: lead.visibility,
      financialBucket: lead.financialBucket,
      createdAt: new Date().toISOString().slice(0, 10),
      jobId: null,
    };
    createQuote(quote);
    updateLead(lead.id, { stage: "quoted", quoteId: quote.id });
    log({ action: "updated", entityType: "lead", entityId: lead.id, summary: `${messages.convertToQuote}: ${lead.clientName}`, source: "user" });
  }

  function handleQuoteToJob(quote: Quote) {
    const job: Job = {
      id: `job-${Date.now()}`,
      quoteId: quote.id,
      clientName: quote.clientName,
      title: quote.title,
      notes: quote.notes,
      amount: quote.amount,
      currency: quote.currency,
      status: "scheduled",
      visibility: quote.visibility,
      financialBucket: quote.financialBucket,
      createdAt: new Date().toISOString().slice(0, 10),
      invoiceId: null,
    };
    createJob(job);
    updateQuote(quote.id, { jobId: job.id });
    if (quote.leadId) updateLead(quote.leadId, { stage: "won" });
    log({ action: "updated", entityType: "quote", entityId: quote.id, summary: `${messages.convertToJob}: ${quote.clientName}`, source: "user" });
  }

  function handleJobToInvoice(job: Job) {
    const invoiceId = `invoice-${Date.now()}`;
    createInvoice({
      id: invoiceId,
      number: `INV-${Date.now().toString().slice(-6)}`,
      client: job.clientName,
      amount: job.amount,
      currency: job.currency,
      status: "unpaid",
      bucket: job.financialBucket,
      visibility: job.visibility,
      date: new Date().toISOString().slice(0, 10),
    });
    updateJob(job.id, { status: "invoiced", invoiceId });
    log({ action: "updated", entityType: "job", entityId: job.id, summary: `${messages.convertToInvoice}: ${job.clientName}`, source: "user" });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{pageTitle}</h1>
        <Button className={styles.newButton} onClick={() => setSheetOpen(true)}>
          {kindForTab[tab] === "lead"
            ? messages.newLead
            : kindForTab[tab] === "quote"
              ? messages.newQuote
              : kindForTab[tab] === "job"
                ? messages.newJob
                : messages.newProject}
        </Button>
      </header>

      {pageIntro && <p className={styles.pageIntro}>{pageIntro}</p>}

      <div className={styles.tabRow}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.tab} ${tab === item.key ? styles.tabActive : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "leads" && (
        <div className={styles.list}>
          {leads.length === 0 && <div className={styles.empty}>{messages.emptyLeads}</div>}
          {leads.map((lead) => (
            <div key={lead.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardBody}>
                  <span className={styles.cardClient}>{lead.clientName}</span>
                  <span className={styles.cardTitle}>{lead.title}</span>
                </div>
              </div>
              <div className={styles.chipRow}>
                {(["new", "contacted", "quoted", "won", "lost"] as LeadStage[]).map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    className={`${styles.chip} ${lead.stage === stage ? styles.chipActive : ""}`}
                    onClick={() => updateLead(lead.id, { stage })}
                  >
                    {leadStageLabel[stage]}
                  </button>
                ))}
              </div>
              {!lead.quoteId && (
                <div className={styles.actionRow}>
                  <button type="button" className={styles.actionButton} onClick={() => handleLeadToQuote(lead)}>
                    <Icon name="receipt" size={14} />
                    {messages.convertToQuote}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "quotes" && (
        <div className={styles.list}>
          {quotes.length === 0 && <div className={styles.empty}>{messages.emptyQuotes}</div>}
          {quotes.map((quote) => (
            <div key={quote.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardBody}>
                  <span className={styles.cardClient}>{quote.clientName}</span>
                  <span className={styles.cardTitle}>{quote.title}</span>
                </div>
                <span className={styles.cardAmount}>
                  {formatCurrency(quote.amount, quote.currency, locale)}
                </span>
              </div>
              <div className={styles.chipRow}>
                {(["draft", "sent", "accepted", "declined"] as QuoteStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`${styles.chip} ${quote.status === status ? styles.chipActive : ""}`}
                    onClick={() => updateQuote(quote.id, { status })}
                  >
                    {quoteStatusLabel[status]}
                  </button>
                ))}
              </div>
              {quote.status === "accepted" && !quote.jobId && (
                <div className={styles.actionRow}>
                  <button type="button" className={styles.actionButton} onClick={() => handleQuoteToJob(quote)}>
                    <Icon name="work" size={14} />
                    {messages.convertToJob}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "jobs" && (
        <div className={styles.list}>
          {jobs.length === 0 && <div className={styles.empty}>{messages.emptyJobs}</div>}
          {jobs.map((job) => (
            <div key={job.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardBody}>
                  <span className={styles.cardClient}>{job.clientName}</span>
                  <span className={styles.cardTitle}>{job.title}</span>
                </div>
                <span className={styles.cardAmount}>
                  {formatCurrency(job.amount, job.currency, locale)}
                </span>
              </div>
              <div className={styles.chipRow}>
                {(["scheduled", "inProgress", "done", "invoiced"] as JobStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`${styles.chip} ${job.status === status ? styles.chipActive : ""}`}
                    disabled={status === "invoiced" && !job.invoiceId}
                    onClick={() => status !== "invoiced" && updateJob(job.id, { status })}
                  >
                    {jobStatusLabel[status]}
                  </button>
                ))}
              </div>
              {job.status === "done" && !job.invoiceId && (
                <div className={styles.actionRow}>
                  <button type="button" className={styles.actionButton} onClick={() => handleJobToInvoice(job)}>
                    <Icon name="receipt" size={14} />
                    {messages.convertToInvoice}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "projects" && (
        <div className={styles.list}>
          {projects.length === 0 && <div className={styles.empty}>{messages.emptyProjects}</div>}
          {projects.map((project) => (
            <div key={project.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardBody}>
                  <span className={styles.cardClient}>{project.clientName}</span>
                  <span className={styles.cardTitle}>{project.title}</span>
                </div>
              </div>
              <div className={styles.chipRow}>
                {(["active", "onHold", "done"] as ProjectStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`${styles.chip} ${project.status === status ? styles.chipActive : ""}`}
                    onClick={() => updateProject(project.id, { status })}
                  >
                    {projectStatusLabel[status]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className={styles.fab}
        onClick={() => setSheetOpen(true)}
        aria-label={messages.newLead}
      >
        <Icon name="plus" size={24} />
      </button>

      <WorkItemSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSave={handleCreate}
        kind={kindForTab[tab]}
        messages={messages}
        appointmentMessages={appointmentMessages}
        prefillClient={prefillClient}
      />
    </main>
  );
}
