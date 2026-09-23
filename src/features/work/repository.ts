import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Job, Lead, Project, Quote } from "./types";
import { demoJobs, demoLeads, demoProjects, demoQuotes } from "./demoData";

const leadCache = new Map<string, Repository<Lead>>();
const quoteCache = new Map<string, Repository<Quote>>();
const jobCache = new Map<string, Repository<Job>>();
const projectCache = new Map<string, Repository<Project>>();

export function getLeadsRepository(workspaceSlug: string): Repository<Lead> {
  const key = `serviceos:${workspaceSlug}:leads`;
  let repository = leadCache.get(key);
  if (!repository) {
    repository = createLocalRepository<Lead>(key, demoLeads);
    leadCache.set(key, repository);
  }
  return repository;
}

export function getQuotesRepository(workspaceSlug: string): Repository<Quote> {
  const key = `serviceos:${workspaceSlug}:quotes`;
  let repository = quoteCache.get(key);
  if (!repository) {
    repository = createLocalRepository<Quote>(key, demoQuotes);
    quoteCache.set(key, repository);
  }
  return repository;
}

export function getJobsRepository(workspaceSlug: string): Repository<Job> {
  const key = `serviceos:${workspaceSlug}:jobs`;
  let repository = jobCache.get(key);
  if (!repository) {
    repository = createLocalRepository<Job>(key, demoJobs);
    jobCache.set(key, repository);
  }
  return repository;
}

export function getProjectsRepository(workspaceSlug: string): Repository<Project> {
  const key = `serviceos:${workspaceSlug}:projects`;
  let repository = projectCache.get(key);
  if (!repository) {
    repository = createLocalRepository<Project>(key, demoProjects);
    projectCache.set(key, repository);
  }
  return repository;
}
