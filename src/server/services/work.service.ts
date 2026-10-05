import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { resolveToday } from "@/lib/time/zonedTime";
import { getWorkspaceTimeZone } from "@/server/services/finance.service";
import {
  getServerAuditLogRepository,
  getServerJobsRepository,
  getServerLeadsRepository,
  getServerProjectsRepository,
  getServerQuotesRepository,
  getServerWorkOps,
} from "@/server/repository/registry";
import { RepositoryNotFoundError } from "@/server/repository/errors";
import {
  conversionOverridesSchema,
  createJobSchema,
  createLeadSchema,
  createProjectSchema,
  createQuoteSchema,
  updateJobSchema,
  updateLeadSchema,
  updateProjectSchema,
  updateQuoteSchema,
  type ConversionOverrides,
  type CreateJobInput,
  type CreateLeadInput,
  type CreateProjectInput,
  type CreateQuoteInput,
  type UpdateJobInput,
  type UpdateLeadInput,
  type UpdateProjectInput,
  type UpdateQuoteInput,
} from "@/server/validation/work.schema";
import type { Job, Lead, Project, Quote } from "@/features/work/types";
import type { AuditLogEntry } from "@/features/auditLog/types";

/**
 * Work pipeline service: Lead -> Quote -> (accepted) Job and/or Project -> Invoice.
 * Reads need `clients.view`, writes `clients.edit` (default-deny); the database enforces the same plus the
 * privacy rules (visibility, private financial bucket) through RLS. One audit entry per create / status change /
 * conversion; summaries are generic: no client names, no amounts, no free text (no PII copies).
 */
type Entity = "lead" | "quote" | "job" | "project";
const LABEL: Record<Entity, string> = { lead: "Lead", quote: "Quote", job: "Job", project: "Project" };

async function audit(session: Session, action: AuditLogEntry["action"], entityType: Entity, entityId: string, summary: string) {
  await getServerAuditLogRepository(session.workspaceId).create({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    entityType,
    entityId,
    summary,
    source: "user",
  });
}

/** The business day in the WORKSPACE timezone (never the UTC date); demo workspaces fall back to the local date. */
const today = async (s: Session) => resolveToday(new Date(), await getWorkspaceTimeZone(s));
const view = (s: Session) => assertCan(s.role, "clients.view");
const edit = (s: Session) => assertCan(s.role, "clients.edit");

// ---- leads ---------------------------------------------------------------------------------
export async function listLeads(session: Session): Promise<Lead[]> {
  view(session);
  return getServerLeadsRepository(session.workspaceId).list();
}
export async function createLead(session: Session, input: CreateLeadInput): Promise<Lead> {
  edit(session);
  const d = createLeadSchema.parse(input);
  const created = await getServerLeadsRepository(session.workspaceId).create({
    ...d,
    id: crypto.randomUUID(),
    createdAt: await today(session),
    stage: "new",
    quoteId: null,
  });
  await audit(session, "created", "lead", created.id, "Lead created");
  return created;
}
export async function updateLead(session: Session, id: string, input: UpdateLeadInput): Promise<Lead> {
  edit(session);
  const patch = updateLeadSchema.parse(input) as Partial<Lead>;
  const updated = await getServerLeadsRepository(session.workspaceId).update(id, patch);
  if (!updated) throw new RepositoryNotFoundError("leads.update");
  await audit(session, patch.stage ? "statusChanged" : "updated", "lead", id, patch.stage ? `Lead stage: ${patch.stage}` : "Lead updated");
  return updated;
}

// ---- quotes --------------------------------------------------------------------------------
export async function listQuotes(session: Session): Promise<Quote[]> {
  view(session);
  return getServerQuotesRepository(session.workspaceId).list();
}
export async function createQuote(session: Session, input: CreateQuoteInput): Promise<Quote> {
  edit(session);
  const d = createQuoteSchema.parse(input);
  const created = await getServerQuotesRepository(session.workspaceId).create({
    ...d,
    id: crypto.randomUUID(),
    createdAt: await today(session),
    leadId: null,
    status: "draft",
    jobId: null,
  });
  await audit(session, "created", "quote", created.id, "Quote created");
  return created;
}
export async function updateQuote(session: Session, id: string, input: UpdateQuoteInput): Promise<Quote> {
  edit(session);
  const patch = updateQuoteSchema.parse(input) as Partial<Quote>;
  const updated = await getServerQuotesRepository(session.workspaceId).update(id, patch);
  if (!updated) throw new RepositoryNotFoundError("quotes.update");
  await audit(session, patch.status ? "statusChanged" : "updated", "quote", id, patch.status ? `Quote status: ${patch.status}` : "Quote updated");
  return updated;
}

// ---- jobs ----------------------------------------------------------------------------------
export async function listJobs(session: Session): Promise<Job[]> {
  view(session);
  return getServerJobsRepository(session.workspaceId).list();
}
export async function createJob(session: Session, input: CreateJobInput): Promise<Job> {
  edit(session);
  const d = createJobSchema.parse(input);
  const created = await getServerJobsRepository(session.workspaceId).create({
    ...d,
    id: crypto.randomUUID(),
    createdAt: await today(session),
    quoteId: null,
    status: "scheduled",
    invoiceId: null,
  });
  await audit(session, "created", "job", created.id, "Job created");
  return created;
}
export async function updateJob(session: Session, id: string, input: UpdateJobInput): Promise<Job> {
  edit(session);
  const patch = updateJobSchema.parse(input) as Partial<Job>;
  const updated = await getServerJobsRepository(session.workspaceId).update(id, patch);
  if (!updated) throw new RepositoryNotFoundError("jobs.update");
  await audit(session, patch.status ? "statusChanged" : "updated", "job", id, patch.status ? `Job status: ${patch.status}` : "Job updated");
  return updated;
}

// ---- projects ------------------------------------------------------------------------------
export async function listProjects(session: Session): Promise<Project[]> {
  view(session);
  return getServerProjectsRepository(session.workspaceId).list();
}
export async function createProject(session: Session, input: CreateProjectInput): Promise<Project> {
  edit(session);
  const d = createProjectSchema.parse(input);
  const created = await getServerProjectsRepository(session.workspaceId).create({
    ...d,
    id: crypto.randomUUID(),
    createdAt: await today(session),
    status: "active",
  });
  await audit(session, "created", "project", created.id, "Project created");
  return created;
}
export async function updateProject(session: Session, id: string, input: UpdateProjectInput): Promise<Project> {
  edit(session);
  const patch = updateProjectSchema.parse(input) as Partial<Project>;
  const updated = await getServerProjectsRepository(session.workspaceId).update(id, patch);
  if (!updated) throw new RepositoryNotFoundError("projects.update");
  await audit(session, patch.status ? "statusChanged" : "updated", "project", id, patch.status ? `Project status: ${patch.status}` : "Project updated");
  return updated;
}

// ---- archive (work is history: never deleted) ------------------------------------------------
export async function archiveWork(session: Session, kind: Entity, id: string): Promise<void> {
  edit(session);
  const repo = {
    lead: getServerLeadsRepository,
    quote: getServerQuotesRepository,
    job: getServerJobsRepository,
    project: getServerProjectsRepository,
  }[kind](session.workspaceId) as { get(id: string): Promise<unknown>; remove(id: string): Promise<void> };
  if (!(await repo.get(id))) throw new RepositoryNotFoundError(`${kind}.archive`);
  await repo.remove(id);
  await audit(session, "updated", kind, id, `${LABEL[kind]} archived`);
}

// ---- conversions ---------------------------------------------------------------------------
/** Lead -> Quote. Idempotent: a second call returns the existing quote (no audit entry, no duplicate). */
export async function convertLeadToQuote(session: Session, leadId: string, overrides?: ConversionOverrides) {
  edit(session);
  const o = conversionOverridesSchema.parse(overrides ?? {});
  const result = await getServerWorkOps(session.workspaceId).convertLeadToQuote(leadId, o);
  if (result.created) await audit(session, "created", "quote", result.quoteId, "Quote created from lead");
  return result;
}

/** Accepts the quote and creates its job (once), optionally inside a project. Idempotent. */
export async function acceptQuoteCreateJob(session: Session, quoteId: string, projectId?: string | null, overrides?: ConversionOverrides) {
  edit(session);
  const o = conversionOverridesSchema.parse(overrides ?? {});
  const result = await getServerWorkOps(session.workspaceId).acceptQuoteCreateJob(quoteId, projectId ?? null, o);
  if (result.created) {
    await audit(session, "statusChanged", "quote", quoteId, "Quote accepted, job created");
    await audit(session, "created", "job", result.jobId, "Job created from quote");
  }
  return result;
}

export async function createProjectForJob(session: Session, jobId: string) {
  edit(session);
  const result = await getServerWorkOps(session.workspaceId).createProjectForJob(jobId);
  if (result.created) await audit(session, "created", "project", result.projectId, "Project created from job");
  return result;
}

export async function attachJobToProject(session: Session, jobId: string, projectId: string): Promise<void> {
  edit(session);
  await getServerWorkOps(session.workspaceId).attachJobToProject(jobId, projectId);
  await audit(session, "updated", "job", jobId, "Job attached to project");
}
