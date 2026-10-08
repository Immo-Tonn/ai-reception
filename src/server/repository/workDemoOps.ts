import "server-only";
import type { Repository } from "@/lib/repository/types";
import type { Job, Lead, Project, Quote } from "@/features/work/types";
import { BusinessRuleError } from "@/server/services/businessRuleError";
import { RepositoryNotFoundError } from "./errors";
import type { ConversionOverrides, WorkOps } from "./workSupabaseRepositories";

/** Demo workspaces: the same conversion rules over the in-memory mock repositories (same results, same errors). */
export function createDemoWorkOps(repos: {
  leads: Repository<Lead>;
  quotes: Repository<Quote>;
  jobs: Repository<Job>;
  projects: Repository<Project>;
}): WorkOps {
  const today = () => new Date().toISOString().slice(0, 10);
  const must = <T>(v: T | undefined, ctx: string): T => {
    if (!v) throw new RepositoryNotFoundError(ctx);
    return v;
  };
  return {
    async convertLeadToQuote(leadId, o?: ConversionOverrides) {
      const lead = must(await repos.leads.get(leadId), "leads.get");
      const existing = (await repos.quotes.list()).find((q) => q.leadId === lead.id);
      if (existing) return { quoteId: existing.id, created: false };
      if (lead.stage === "lost") throw new BusinessRuleError("lead_lost", "invalid_work_transition");
      const quote: Quote = {
        id: crypto.randomUUID(),
        leadId: lead.id,
        clientId: lead.clientId ?? null,
        clientName: lead.clientName,
        title: lead.title,
        notes: lead.notes,
        amount: lead.estimatedValue ?? 0,
        currency: lead.currency ?? "EUR",
        status: "draft",
        visibility: o?.visibility ?? lead.visibility,
        financialBucket: lead.financialBucket,
        createdAt: today(),
        jobId: null,
      };
      await repos.quotes.create(quote);
      await repos.leads.update(lead.id, { stage: "quoted", quoteId: quote.id });
      return { quoteId: quote.id, created: true };
    },
    async acceptQuoteCreateJob(quoteId, projectId, o?: ConversionOverrides) {
      const quote = must(await repos.quotes.get(quoteId), "quotes.get");
      const existing = (await repos.jobs.list()).find((j) => j.quoteId === quote.id);
      if (existing) return { jobId: existing.id, created: false };
      if (quote.status === "declined") throw new BusinessRuleError("quote_declined", "invalid_work_transition");
      const job: Job = {
        id: crypto.randomUUID(),
        quoteId: quote.id,
        clientId: quote.clientId ?? null,
        clientName: quote.clientName,
        title: quote.title,
        notes: quote.notes,
        amount: quote.amount,
        currency: quote.currency,
        status: "scheduled",
        visibility: o?.visibility ?? quote.visibility,
        financialBucket: quote.financialBucket,
        createdAt: today(),
        invoiceId: null,
        projectId: projectId ?? null,
      };
      await repos.jobs.create(job);
      await repos.quotes.update(quote.id, { status: "accepted", jobId: job.id });
      if (quote.leadId) await repos.leads.update(quote.leadId, { stage: "won" });
      return { jobId: job.id, created: true };
    },
    async createProjectForJob(jobId) {
      const job = must(await repos.jobs.get(jobId), "jobs.get");
      if (job.projectId) return { projectId: job.projectId, created: false };
      const project: Project = {
        id: crypto.randomUUID(),
        clientId: job.clientId ?? null,
        clientName: job.clientName,
        title: job.title,
        notes: job.notes,
        status: "active",
        visibility: job.visibility,
        financialBucket: job.financialBucket,
        createdAt: today(),
      };
      await repos.projects.create(project);
      await repos.jobs.update(job.id, { projectId: project.id });
      return { projectId: project.id, created: true };
    },
    async attachJobToProject(jobId, projectId) {
      must(await repos.jobs.get(jobId), "jobs.get");
      must(await repos.projects.get(projectId), "projects.get");
      await repos.jobs.update(jobId, { projectId });
    },
  };
}
