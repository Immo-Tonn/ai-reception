import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Job, Lead, Project, Quote } from "./types";
import { demoJobs, demoLeads, demoProjects, demoQuotes } from "./demoData";

// Demo data belongs to the four demo workspaces only. A real workspace starts EMPTY until this
// entity has its own shared backend — it must never show someone else's fake records.
const leadCache = new Map<string, Repository<Lead>>();
const quoteCache = new Map<string, Repository<Quote>>();
const jobCache = new Map<string, Repository<Job>>();
const projectCache = new Map<string, Repository<Project>>();

export function getLeadsRepository(workspaceSlug: string): Repository<Lead> {
  const key = `serviceos:${workspaceSlug}:leads`;
  let repository = leadCache.get(key);
  if (!repository) {
    repository = createLocalRepository<Lead>(key, isDemoWorkspaceSlug(workspaceSlug) ? demoLeads : []);
    leadCache.set(key, repository);
  }
  return repository;
}

export function getQuotesRepository(workspaceSlug: string): Repository<Quote> {
  const key = `serviceos:${workspaceSlug}:quotes`;
  let repository = quoteCache.get(key);
  if (!repository) {
    repository = createLocalRepository<Quote>(key, isDemoWorkspaceSlug(workspaceSlug) ? demoQuotes : []);
    quoteCache.set(key, repository);
  }
  return repository;
}

export function getJobsRepository(workspaceSlug: string): Repository<Job> {
  const key = `serviceos:${workspaceSlug}:jobs`;
  let repository = jobCache.get(key);
  if (!repository) {
    repository = createLocalRepository<Job>(key, isDemoWorkspaceSlug(workspaceSlug) ? demoJobs : []);
    jobCache.set(key, repository);
  }
  return repository;
}

export function getProjectsRepository(workspaceSlug: string): Repository<Project> {
  const key = `serviceos:${workspaceSlug}:projects`;
  let repository = projectCache.get(key);
  if (!repository) {
    repository = createLocalRepository<Project>(key, isDemoWorkspaceSlug(workspaceSlug) ? demoProjects : []);
    projectCache.set(key, repository);
  }
  return repository;
}
