"use server";

import { getSession } from "@/server/auth/session";
import * as work from "@/server/services/work.service";
import { runAction, type ActionResult } from "./result";
import type { Job, Lead, Project, Quote } from "@/features/work/types";
import type {
  ConversionOverrides,
  CreateJobInput,
  CreateLeadInput,
  CreateProjectInput,
  CreateQuoteInput,
  UpdateJobInput,
  UpdateLeadInput,
  UpdateProjectInput,
  UpdateQuoteInput,
} from "@/server/validation/work.schema";

export async function listLeadsAction(slug: string): Promise<ActionResult<Lead[]>> {
  return runAction(async () => work.listLeads(await getSession(slug)));
}
export async function createLeadAction(slug: string, input: CreateLeadInput): Promise<ActionResult<Lead>> {
  return runAction(async () => work.createLead(await getSession(slug), input));
}
export async function updateLeadAction(slug: string, id: string, input: UpdateLeadInput): Promise<ActionResult<Lead>> {
  return runAction(async () => work.updateLead(await getSession(slug), id, input));
}

export async function listQuotesAction(slug: string): Promise<ActionResult<Quote[]>> {
  return runAction(async () => work.listQuotes(await getSession(slug)));
}
export async function createQuoteAction(slug: string, input: CreateQuoteInput): Promise<ActionResult<Quote>> {
  return runAction(async () => work.createQuote(await getSession(slug), input));
}
export async function updateQuoteAction(slug: string, id: string, input: UpdateQuoteInput): Promise<ActionResult<Quote>> {
  return runAction(async () => work.updateQuote(await getSession(slug), id, input));
}

export async function listJobsAction(slug: string): Promise<ActionResult<Job[]>> {
  return runAction(async () => work.listJobs(await getSession(slug)));
}
export async function createJobAction(slug: string, input: CreateJobInput): Promise<ActionResult<Job>> {
  return runAction(async () => work.createJob(await getSession(slug), input));
}
export async function updateJobAction(slug: string, id: string, input: UpdateJobInput): Promise<ActionResult<Job>> {
  return runAction(async () => work.updateJob(await getSession(slug), id, input));
}

export async function listProjectsAction(slug: string): Promise<ActionResult<Project[]>> {
  return runAction(async () => work.listProjects(await getSession(slug)));
}
export async function createProjectAction(slug: string, input: CreateProjectInput): Promise<ActionResult<Project>> {
  return runAction(async () => work.createProject(await getSession(slug), input));
}
export async function updateProjectAction(slug: string, id: string, input: UpdateProjectInput): Promise<ActionResult<Project>> {
  return runAction(async () => work.updateProject(await getSession(slug), id, input));
}

export async function archiveWorkAction(slug: string, kind: "lead" | "quote" | "job" | "project", id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await work.archiveWork(await getSession(slug), kind, id);
    return null;
  });
}

export async function convertLeadToQuoteAction(
  slug: string,
  leadId: string,
  overrides?: ConversionOverrides,
): Promise<ActionResult<{ quoteId: string; created: boolean }>> {
  return runAction(async () => work.convertLeadToQuote(await getSession(slug), leadId, overrides));
}
export async function acceptQuoteCreateJobAction(
  slug: string,
  quoteId: string,
  projectId?: string | null,
  overrides?: ConversionOverrides,
): Promise<ActionResult<{ jobId: string; created: boolean }>> {
  return runAction(async () => work.acceptQuoteCreateJob(await getSession(slug), quoteId, projectId, overrides));
}
export async function createProjectForJobAction(slug: string, jobId: string): Promise<ActionResult<{ projectId: string; created: boolean }>> {
  return runAction(async () => work.createProjectForJob(await getSession(slug), jobId));
}
export async function attachJobToProjectAction(slug: string, jobId: string, projectId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await work.attachJobToProject(await getSession(slug), jobId, projectId);
    return null;
  });
}
