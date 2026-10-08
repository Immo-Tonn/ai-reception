"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Icon, SaveStatus } from "@/components/ui";
import type { SaveState } from "@/components/ui";
import { useLeads, useQuotes, useJobs, useProjects } from "@/features/work/useWork";
import { useInvoices } from "@/features/finance/useInvoices";
import { useAuditLog } from "@/features/auditLog/useAuditLog";
import { useWorkspaceConfig, useWorkspaceToday } from "@/features/workspace/WorkspaceCatalog";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { isQuoteExpired } from "@/features/work/types";
import type { Job, Lead, LeadStage, Project, ProjectStatus, Quote, QuoteStatus, JobStatus } from "@/features/work/types";
import { RemoteRepositoryError } from "@/lib/repository/createRemoteRepository";
import { describeSaveError } from "@/lib/repository/describeSaveError";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency } from "@/lib/i18n/format";
import { listClientsAction } from "@/server/actions/clients.actions";
import {
  acceptQuoteCreateJobAction,
  attachJobToProjectAction,
  convertLeadToQuoteAction,
  createProjectForJobAction,
} from "@/server/actions/work.actions";
import { WorkItemSheet, type EditableWork, type WorkItemDraft, type WorkKind } from "./WorkItemSheet";
import styles from "./page.module.css";

type Tab = "leads" | "quotes" | "jobs" | "projects";
type Pending = { action: "leadToQuote" | "acceptQuote" | "projectForJob" | "archive"; kind: WorkKind; id: string } | null;

const nowMs = () => Date.now();

const formatDay = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

export function WorkView({
  workspaceSlug,
  locale,
  messages,
  opsMessages,
  errorMessages,
  appointmentMessages,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["work"];
  opsMessages: Messages["workOps"];
  errorMessages: Messages["repositoryErrors"];
  appointmentMessages: Messages["appointment"];
}) {
  const searchParams = useSearchParams();
  const real = !isDemoWorkspaceSlug(workspaceSlug);
  const workspace = getWorkspaceConfig(workspaceSlug);
  const catalog = useWorkspaceConfig(workspaceSlug);
  const pageTitle = workspace.workLabel?.[locale] ?? messages.title;
  const pageIntro = workspace.workIntro?.[locale];
  const leadsState = useLeads(workspaceSlug);
  const quotesState = useQuotes(workspaceSlug);
  const jobsState = useJobs(workspaceSlug);
  const projectsState = useProjects(workspaceSlug);
  const { items: leads } = leadsState;
  const { items: quotes } = quotesState;
  const { items: jobs } = jobsState;
  const { items: projects } = projectsState;
  const { create: createInvoice } = useInvoices(workspaceSlug);
  const { log } = useAuditLog(workspaceSlug);
  const today = useWorkspaceToday(workspaceSlug);

  const [tab, setTab] = useState<Tab>("leads");
  const [sheetOpen, setSheetOpen] = useState(searchParams.get("create") === "lead");
  const [editing, setEditing] = useState<EditableWork | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [save, setSave] = useState<{ state: SaveState; error: string | null }>({ state: "idle", error: null });
  const [realClients, setRealClients] = useState<{ id: string; name: string }[]>([]);
  const prefillClient = searchParams.get("client") ?? "";

  // Client picker: the real clients of the workspace (never a copy; conversions reuse the same client id).
  useEffect(() => {
    if (!real) return;
    let cancelled = false;
    void listClientsAction(workspaceSlug).then((result) => {
      if (!cancelled && result.ok) setRealClients(result.data.map((c) => ({ id: c.id, name: c.name })));
    });
    return () => {
      cancelled = true;
    };
  }, [real, workspaceSlug]);

  const kindForTab: Record<Tab, WorkKind> = { leads: "lead", quotes: "quote", jobs: "job", projects: "project" };
  const current = { leads: leadsState, quotes: quotesState, jobs: jobsState, projects: projectsState }[tab];

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
    cancelled: opsMessages.jobStatusCancelled,
  };
  const projectStatusLabel: Record<ProjectStatus, string> = {
    active: messages.projectStatusActive,
    onHold: messages.projectStatusOnHold,
    done: messages.projectStatusDone,
  };

  const errorText = useCallback(
    (error: unknown) => {
      if (error instanceof RemoteRepositoryError && error.code === "conflict") return opsMessages.errConflict;
      return describeSaveError(error, errorMessages);
    },
    [errorMessages, opsMessages.errConflict],
  );

  /** Every write goes through here: honest saving / saved / error state, never an unhandled rejection. */
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    setSave({ state: "saving", error: null });
    try {
      await fn();
      setSave({ state: "saved", error: null });
      return true;
    } catch (error) {
      setSave({ state: "error", error: errorText(error) });
      return false;
    }
  }

  const refreshAll = useCallback(async () => {
    await Promise.all([leadsState.refresh(), quotesState.refresh(), jobsState.refresh(), projectsState.refresh()]);
  }, [leadsState, quotesState, jobsState, projectsState]);

  function openCreate() {
    setEditing(null);
    setSheetError(null);
    setSheetOpen(true);
  }
  function openEdit(item: EditableWork) {
    setEditing(item);
    setSheetError(null);
    setSheetOpen(true);
  }
  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    setEditing(null);
  }, []);

  async function handleSheetSave(draft: WorkItemDraft) {
    setSheetError(null);
    try {
      if (editing) await saveEdit(editing, draft);
      else await saveNew(draft);
      setSave({ state: "saved", error: null });
    } catch (error) {
      setSheetError(errorText(error));
      throw error;
    }
  }

  async function saveEdit(item: EditableWork, d: WorkItemDraft) {
    const common = { clientId: d.clientId, clientName: d.clientName, title: d.title, notes: d.notes };
    if (tab === "leads") {
      await leadsState.update(item.id, { ...common, ...(real ? { source: d.source, estimatedValue: d.amount } : {}) });
    } else if (tab === "quotes") {
      const had = ((item as Quote).items ?? []).length > 0;
      const useItems = real && (d.items.length > 0 || had);
      await quotesState.update(item.id, {
        ...common,
        ...(useItems ? { items: d.items } : { amount: d.amount }),
        ...(real ? { validUntil: d.validUntil } : {}),
      });
    } else if (tab === "jobs") {
      await jobsState.update(item.id, { ...common, amount: d.amount, ...(real ? { staffId: d.staffId, startsOn: d.startsOn, dueOn: d.dueOn } : {}) });
    } else {
      await projectsState.update(item.id, { ...common, ...(real ? { startsOn: d.startsOn, endsOn: d.endsOn } : {}) });
    }
  }

  async function saveNew(d: WorkItemDraft) {
    const base = {
      id: `${kindForTab[tab]}-${nowMs()}`, // real workspaces: the server assigns the real id
      clientName: d.clientName,
      clientId: d.clientId,
      title: d.title,
      notes: d.notes,
      visibility: d.visibility ?? "normal",
      financialBucket: d.financialBucket ?? "main",
      createdAt: today,
    };
    if (tab === "leads") {
      const lead: Lead = { ...base, stage: "new", quoteId: null, ...(real ? { source: d.source, estimatedValue: d.amount || null } : {}) };
      await leadsState.create(lead);
      if (!real) log({ action: "created", entityType: "lead", entityId: lead.id, summary: `${lead.clientName} · ${lead.title}`, source: "user" });
    } else if (tab === "quotes") {
      const quote: Quote = {
        ...base,
        leadId: null,
        amount: d.amount,
        currency: "EUR",
        status: "draft",
        jobId: null,
        ...(real ? { validUntil: d.validUntil, items: d.items } : {}),
      };
      await quotesState.create(quote);
      if (!real) log({ action: "created", entityType: "quote", entityId: quote.id, summary: `${quote.clientName} · ${quote.title}`, source: "user" });
    } else if (tab === "jobs") {
      const job: Job = {
        ...base,
        quoteId: null,
        amount: d.amount,
        currency: "EUR",
        status: "scheduled",
        invoiceId: null,
        ...(real ? { staffId: d.staffId, startsOn: d.startsOn, dueOn: d.dueOn } : {}),
      };
      await jobsState.create(job);
      if (!real) log({ action: "created", entityType: "job", entityId: job.id, summary: `${job.clientName} · ${job.title}`, source: "user" });
    } else {
      const project: Project = { ...base, status: "active", ...(real ? { startsOn: d.startsOn, endsOn: d.endsOn } : {}) };
      await projectsState.create(project);
      if (!real) log({ action: "created", entityType: "project", entityId: project.id, summary: `${project.clientName} · ${project.title}`, source: "user" });
    }
  }

  // ---- conversions (real: one atomic, idempotent database function each; demo: local) ------------------------
  async function handleLeadToQuote(lead: Lead) {
    setPending(null);
    if (real) {
      await run(async () => {
        const result = await convertLeadToQuoteAction(workspaceSlug, lead.id);
        if (!result.ok) throw new RemoteRepositoryError(result.code);
        await refreshAll();
      });
      return;
    }
    const quote: Quote = {
      id: `quote-${nowMs()}`,
      leadId: lead.id,
      clientName: lead.clientName,
      title: lead.title,
      notes: lead.notes,
      amount: 0,
      currency: "EUR",
      status: "draft",
      visibility: lead.visibility,
      financialBucket: lead.financialBucket,
      createdAt: today,
      jobId: null,
    };
    await quotesState.create(quote);
    await leadsState.update(lead.id, { stage: "quoted", quoteId: quote.id });
    log({ action: "updated", entityType: "lead", entityId: lead.id, summary: `${messages.convertToQuote}: ${lead.clientName}`, source: "user" });
  }

  async function handleQuoteToJob(quote: Quote) {
    setPending(null);
    if (real) {
      await run(async () => {
        const result = await acceptQuoteCreateJobAction(workspaceSlug, quote.id);
        if (!result.ok) throw new RemoteRepositoryError(result.code);
        await refreshAll();
      });
      return;
    }
    const job: Job = {
      id: `job-${nowMs()}`,
      quoteId: quote.id,
      clientName: quote.clientName,
      title: quote.title,
      notes: quote.notes,
      amount: quote.amount,
      currency: quote.currency,
      status: "scheduled",
      visibility: quote.visibility,
      financialBucket: quote.financialBucket,
      createdAt: today,
      invoiceId: null,
    };
    await jobsState.create(job);
    await quotesState.update(quote.id, { jobId: job.id });
    if (quote.leadId) await leadsState.update(quote.leadId, { stage: "won" });
    log({ action: "updated", entityType: "quote", entityId: quote.id, summary: `${messages.convertToJob}: ${quote.clientName}`, source: "user" });
  }

  async function handleProjectForJob(job: Job) {
    setPending(null);
    await run(async () => {
      const result = await createProjectForJobAction(workspaceSlug, job.id);
      if (!result.ok) throw new RemoteRepositoryError(result.code);
      await refreshAll();
    });
  }

  async function handleAttach(job: Job, projectId: string) {
    if (!projectId) return;
    await run(async () => {
      const result = await attachJobToProjectAction(workspaceSlug, job.id, projectId);
      if (!result.ok) throw new RemoteRepositoryError(result.code);
      await refreshAll();
    });
  }

  async function handleArchive(kind: WorkKind, id: string) {
    setPending(null);
    const state = { lead: leadsState, quote: quotesState, job: jobsState, project: projectsState }[kind];
    await run(() => state.remove(id));
  }

  async function handleJobToInvoice(job: Job) {
    const invoiceId = `invoice-${nowMs()}`;
    createInvoice({
      id: invoiceId,
      number: `INV-${nowMs().toString().slice(-6)}`,
      client: job.clientName,
      amount: job.amount,
      currency: job.currency,
      status: "unpaid",
      bucket: job.financialBucket,
      visibility: job.visibility,
      date: today,
    });
    await jobsState.update(job.id, { status: "invoiced", invoiceId });
    log({ action: "updated", entityType: "job", entityId: job.id, summary: `${messages.convertToInvoice}: ${job.clientName}`, source: "user" });
  }

  // ---- small view helpers ----------------------------------------------------------------------------------
  const projectTitle = useMemo(() => new Map(projects.map((p) => [p.id, p.title])), [projects]);
  const staffName = useMemo(() => new Map(catalog.staff.map((s) => [s.id, s.name])), [catalog.staff]);

  function confirmBar(text: string, onConfirm: () => void, kind: "convert" | "danger"): ReactNode {
    return (
      <div className={styles.confirmBar} role="group" aria-label={text}>
        <p className={styles.confirmText}>{text}</p>
        <div className={styles.actionRow}>
          <button type="button" className={kind === "danger" ? styles.confirmDanger : styles.confirmButton} onClick={onConfirm}>
            {opsMessages.confirm}
          </button>
          <button type="button" className={styles.actionButton} onClick={() => setPending(null)}>
            {messages.cancel}
          </button>
        </div>
      </div>
    );
  }

  function cardTools(item: EditableWork, kind: WorkKind): ReactNode {
    if (!real) return null;
    return (
      <>
        <div className={styles.actionRow}>
          <button type="button" className={styles.actionButton} onClick={() => openEdit(item)}>
            {opsMessages.edit}
          </button>
          <button type="button" className={styles.actionButton} onClick={() => setPending({ action: "archive", kind, id: item.id })}>
            {opsMessages.archive}
          </button>
        </div>
        {pending?.action === "archive" && pending.id === item.id && confirmBar(opsMessages.archiveConfirm, () => void handleArchive(kind, item.id), "danger")}
      </>
    );
  }

  function listState(count: number, emptyText: string): ReactNode {
    if (real && !current.loaded) {
      return (
        <div className={styles.empty} role="status">
          {opsMessages.loading}
        </div>
      );
    }
    if (real && current.loadError) {
      return (
        <div className={styles.empty} role="alert">
          <span>{opsMessages.loadError}</span>
          <button type="button" className={styles.actionButton} onClick={() => void refreshAll()}>
            {opsMessages.retry}
          </button>
        </div>
      );
    }
    return count === 0 ? <div className={styles.empty}>{emptyText}</div> : null;
  }

  const newLabel =
    kindForTab[tab] === "lead" ? messages.newLead : kindForTab[tab] === "quote" ? messages.newQuote : kindForTab[tab] === "job" ? messages.newJob : messages.newProject;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{pageTitle}</h1>
        <Button className={styles.newButton} onClick={openCreate}>
          {newLabel}
        </Button>
      </header>

      {pageIntro && <p className={styles.pageIntro}>{pageIntro}</p>}

      {real && (
        <div className={styles.saveLine}>
          <SaveStatus state={save.state} labels={opsMessages.saveLabels} error={save.error} onSavedExpire={() => setSave({ state: "idle", error: null })} />
        </div>
      )}

      <div className={styles.tabRow} role="tablist">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`${styles.tab} ${tab === item.key ? styles.tabActive : ""}`}
            onClick={() => {
              setTab(item.key);
              setPending(null);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "leads" && (
        <div className={styles.list}>
          {listState(leads.length, messages.emptyLeads)}
          {leads.map((lead) => (
            <div key={lead.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardBody}>
                  <span className={styles.cardClient}>{lead.clientName}</span>
                  <span className={styles.cardTitle}>{lead.title}</span>
                </div>
                {real && lead.estimatedValue ? <span className={styles.cardAmount}>{formatCurrency(lead.estimatedValue, lead.currency ?? "EUR", locale)}</span> : null}
              </div>
              <div className={styles.chipRow}>
                {/* "won"/"lost" stay in the model (a quote→job conversion still sets
                    "won", analytics reads it) but aren't shown as buttons: that's CRM
                    pipeline vocabulary the product doesn't need yet. */}
                {(["new", "contacted", "quoted"] as LeadStage[]).map((stage) => (
                  <button
                    key={stage}
                    type="button"
                    className={`${styles.chip} ${lead.stage === stage ? styles.chipActive : ""}`}
                    aria-pressed={lead.stage === stage}
                    onClick={() => void run(() => leadsState.update(lead.id, { stage }))}
                  >
                    {leadStageLabel[stage]}
                  </button>
                ))}
              </div>
              <div className={styles.actionRow}>
                {!lead.quoteId && lead.stage !== "lost" && (
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => (real ? setPending({ action: "leadToQuote", kind: "lead", id: lead.id }) : void handleLeadToQuote(lead))}
                  >
                    <Icon name="receipt" size={14} />
                    {messages.convertToQuote}
                  </button>
                )}
                {lead.quoteId && real && <span className={styles.bucketNote}>{opsMessages.alreadyConverted}</span>}
              </div>
              {pending?.action === "leadToQuote" && pending.id === lead.id && confirmBar(opsMessages.convertLeadConfirm, () => void handleLeadToQuote(lead), "convert")}
              {cardTools(lead, "lead")}
            </div>
          ))}
        </div>
      )}

      {tab === "quotes" && (
        <div className={styles.list}>
          {listState(quotes.length, messages.emptyQuotes)}
          {quotes.map((quote) => (
            <div key={quote.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardBody}>
                  <span className={styles.cardClient}>{quote.clientName}</span>
                  <span className={styles.cardTitle}>{quote.title}</span>
                  {real && quote.validUntil && (
                    <span className={styles.bucketNote}>
                      {opsMessages.validUntilLabel}: {formatDay(quote.validUntil, locale)}
                      {isQuoteExpired(quote, today) ? ` · ${opsMessages.expired}` : ""}
                    </span>
                  )}
                </div>
                <span className={styles.cardAmount}>{formatCurrency(quote.amount, quote.currency, locale)}</span>
              </div>
              <div className={styles.chipRow}>
                {(["draft", "sent", "accepted", "declined"] as QuoteStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`${styles.chip} ${quote.status === status ? styles.chipActive : ""}`}
                    aria-pressed={quote.status === status}
                    onClick={() => void run(() => quotesState.update(quote.id, { status }))}
                  >
                    {quoteStatusLabel[status]}
                  </button>
                ))}
              </div>
              {quote.status === "accepted" && !quote.jobId && (
                <div className={styles.actionRow}>
                  <button
                    type="button"
                    className={styles.actionButton}
                    onClick={() => (real ? setPending({ action: "acceptQuote", kind: "quote", id: quote.id }) : void handleQuoteToJob(quote))}
                  >
                    <Icon name="work" size={14} />
                    {messages.convertToJob}
                  </button>
                </div>
              )}
              {quote.jobId && real && <span className={styles.bucketNote}>{opsMessages.alreadyConverted}</span>}
              {pending?.action === "acceptQuote" && pending.id === quote.id && confirmBar(opsMessages.acceptQuoteConfirm, () => void handleQuoteToJob(quote), "convert")}
              {cardTools(quote, "quote")}
            </div>
          ))}
        </div>
      )}

      {tab === "jobs" && (
        <div className={styles.list}>
          {listState(jobs.length, messages.emptyJobs)}
          {jobs.map((job) => (
            <div key={job.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardBody}>
                  <span className={styles.cardClient}>{job.clientName}</span>
                  <span className={styles.cardTitle}>{job.title}</span>
                  {real && (job.staffId || job.dueOn || job.projectId) && (
                    <span className={styles.bucketNote}>
                      {[
                        job.staffId ? `${opsMessages.staffLabel}: ${staffName.get(job.staffId) ?? ""}` : "",
                        job.dueOn ? `${opsMessages.dueOnLabel}: ${formatDay(job.dueOn, locale)}` : "",
                        job.projectId ? `${opsMessages.linkedProject}: ${projectTitle.get(job.projectId) ?? ""}` : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {job.invoiceId && (
                    <span className={styles.bucketNote}>
                      {opsMessages.linkedInvoice}: {job.invoiceNumber ?? job.invoiceId}
                    </span>
                  )}
                </div>
                <span className={styles.cardAmount}>{formatCurrency(job.amount, job.currency, locale)}</span>
              </div>
              <div className={styles.chipRow}>
                {(["scheduled", "inProgress", "done", "invoiced", "cancelled"] as JobStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`${styles.chip} ${job.status === status ? styles.chipActive : ""}`}
                    aria-pressed={job.status === status}
                    disabled={status === "invoiced" && !job.invoiceId}
                    onClick={() => status !== "invoiced" && void run(() => jobsState.update(job.id, { status }))}
                  >
                    {jobStatusLabel[status]}
                  </button>
                ))}
              </div>
              <div className={styles.actionRow}>
                {!real && job.status === "done" && !job.invoiceId && (
                  <button type="button" className={styles.actionButton} onClick={() => void handleJobToInvoice(job)}>
                    <Icon name="receipt" size={14} />
                    {messages.convertToInvoice}
                  </button>
                )}
                {real && !job.projectId && (
                  <button type="button" className={styles.actionButton} onClick={() => setPending({ action: "projectForJob", kind: "job", id: job.id })}>
                    <Icon name="work" size={14} />
                    {opsMessages.projectForJob}
                  </button>
                )}
                {real && !job.projectId && projects.length > 0 && (
                  <select suppressHydrationWarning className={styles.selectInline} aria-label={opsMessages.addToProject} value="" onChange={(event) => void handleAttach(job, event.target.value)}>
                    <option value="">{opsMessages.addToProject}</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {pending?.action === "projectForJob" && pending.id === job.id && confirmBar(opsMessages.projectForJobConfirm, () => void handleProjectForJob(job), "convert")}
              {cardTools(job, "job")}
            </div>
          ))}
        </div>
      )}

      {tab === "projects" && (
        <div className={styles.list}>
          {listState(projects.length, messages.emptyProjects)}
          {projects.map((project) => (
            <div key={project.id} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardBody}>
                  <span className={styles.cardClient}>{project.clientName}</span>
                  <span className={styles.cardTitle}>{project.title}</span>
                  {real && (project.startsOn || project.endsOn) && (
                    <span className={styles.bucketNote}>
                      {[project.startsOn ? formatDay(project.startsOn, locale) : "", project.endsOn ? formatDay(project.endsOn, locale) : ""].filter(Boolean).join(" – ")}
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.chipRow}>
                {(["active", "onHold", "done"] as ProjectStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={`${styles.chip} ${project.status === status ? styles.chipActive : ""}`}
                    aria-pressed={project.status === status}
                    onClick={() => void run(() => projectsState.update(project.id, { status }))}
                  >
                    {projectStatusLabel[status]}
                  </button>
                ))}
              </div>
              {cardTools(project, "project")}
            </div>
          ))}
        </div>
      )}

      <button type="button" className={styles.fab} onClick={openCreate} aria-label={newLabel}>
        <Icon name="plus" size={24} />
      </button>

      <WorkItemSheet
        open={sheetOpen}
        onClose={closeSheet}
        onSave={handleSheetSave}
        kind={kindForTab[tab]}
        messages={messages}
        opsMessages={opsMessages}
        appointmentMessages={appointmentMessages}
        prefillClient={prefillClient}
        real={real}
        clients={realClients}
        staff={catalog.staff.map((s) => ({ id: s.id, name: s.name }))}
        editing={editing}
        errorText={sheetError}
      />
    </main>
  );
}
