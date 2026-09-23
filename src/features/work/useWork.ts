"use client";

import { useMemo } from "react";
import { useRepositoryCollection } from "@/lib/repository/useRepository";
import {
  getJobsRepository,
  getLeadsRepository,
  getProjectsRepository,
  getQuotesRepository,
} from "./repository";

export function useLeads(workspaceSlug: string) {
  const repository = useMemo(() => getLeadsRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}

export function useQuotes(workspaceSlug: string) {
  const repository = useMemo(() => getQuotesRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}

export function useJobs(workspaceSlug: string) {
  const repository = useMemo(() => getJobsRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}

export function useProjects(workspaceSlug: string) {
  const repository = useMemo(() => getProjectsRepository(workspaceSlug), [workspaceSlug]);
  return useRepositoryCollection(repository);
}
