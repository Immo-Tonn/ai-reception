import { createRemoteRepository } from "@/lib/repository/createRemoteRepository";
import type { Repository } from "@/lib/repository/types";
import {
  archiveWorkAction,
  createJobAction,
  createLeadAction,
  createProjectAction,
  createQuoteAction,
  listJobsAction,
  listLeadsAction,
  listProjectsAction,
  listQuotesAction,
  updateJobAction,
  updateLeadAction,
  updateProjectAction,
  updateQuoteAction,
} from "@/server/actions/work.actions";
import type { Job, Lead, Project, Quote } from "./types";

/**
 * Work of a REAL workspace: Server Actions over the shared database (RLS + privacy rules). The server picks the id
 * and the creation date; only fields that are set are sent, so an edit never overwrites visibility or bucket
 * values the simple UI does not show.
 */
const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const common = (i: Partial<Lead | Quote | Job | Project>) => ({
  clientName: i.clientName,
  clientId: i.clientId,
  title: i.title,
  notes: i.notes,
  visibility: i.visibility,
  financialBucket: i.financialBucket,
  financialBucketId: i.financialBucketId,
});

export function createRemoteLeadsRepository(slug: string): Repository<Lead> {
  const fields = (i: Partial<Lead>) =>
    defined({ ...common(i), stage: i.stage, source: i.source, estimatedValue: i.estimatedValue, currency: i.currency });
  return createRemoteRepository<Lead>({
    list: () => listLeadsAction(slug),
    create: (item) => createLeadAction(slug, fields(item) as never),
    update: (id, patch) => updateLeadAction(slug, id, fields(patch) as never),
    remove: (id) => archiveWorkAction(slug, "lead", id),
  });
}

export function createRemoteQuotesRepository(slug: string): Repository<Quote> {
  const fields = (i: Partial<Quote>) =>
    defined({ ...common(i), status: i.status, amount: i.amount, currency: i.currency, validUntil: i.validUntil, items: i.items?.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })) });
  return createRemoteRepository<Quote>({
    list: () => listQuotesAction(slug),
    create: (item) => createQuoteAction(slug, fields(item) as never),
    update: (id, patch) => updateQuoteAction(slug, id, fields(patch) as never),
    remove: (id) => archiveWorkAction(slug, "quote", id),
  });
}

export function createRemoteJobsRepository(slug: string): Repository<Job> {
  const fields = (i: Partial<Job>) =>
    defined({ ...common(i), status: i.status, amount: i.amount, currency: i.currency, projectId: i.projectId, staffId: i.staffId, startsOn: i.startsOn, dueOn: i.dueOn });
  return createRemoteRepository<Job>({
    list: () => listJobsAction(slug),
    create: (item) => createJobAction(slug, fields(item) as never),
    update: (id, patch) => updateJobAction(slug, id, fields(patch) as never),
    remove: (id) => archiveWorkAction(slug, "job", id),
  });
}

export function createRemoteProjectsRepository(slug: string): Repository<Project> {
  const fields = (i: Partial<Project>) => defined({ ...common(i), status: i.status, startsOn: i.startsOn, endsOn: i.endsOn });
  return createRemoteRepository<Project>({
    list: () => listProjectsAction(slug),
    create: (item) => createProjectAction(slug, fields(item) as never),
    update: (id, patch) => updateProjectAction(slug, id, fields(patch) as never),
    remove: (id) => archiveWorkAction(slug, "project", id),
  });
}
