"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import type { Repository } from "@/lib/repository/types";
import {
  getJobsRepository,
  getLeadsRepository,
  getProjectsRepository,
  getQuotesRepository,
} from "./repository";
import {
  createRemoteJobsRepository,
  createRemoteLeadsRepository,
  createRemoteProjectsRepository,
  createRemoteQuotesRepository,
} from "./remoteRepository";
import type { Job, Lead, Project, Quote } from "./types";

/**
 * Work collections. Demo workspaces: browser-local demo records (unchanged). REAL workspaces: the shared database
 * through Server Actions; a failed load is reported (`loadError`), never papered over with demo or local data.
 */
function pick<T extends { id: string }>(slug: string, local: (s: string) => Repository<T>, remote: (s: string) => Repository<T>) {
  return isDemoWorkspaceSlug(slug) ? local(slug) : remote(slug);
}

function useWorkCollection<T extends { id: string }>(repository: Repository<T>) {
  // Results are tagged with the repository they came from, so switching workspace never shows (or claims
  // "loaded" for) the previous workspace's items.
  const [state, setState] = useState<{ repository: Repository<T> | null; items: T[]; loadError: boolean }>({
    repository: null,
    items: [],
    loadError: false,
  });

  const refresh = useCallback(async () => {
    try {
      const items = await repository.list();
      setState({ repository, items, loadError: false });
    } catch {
      setState((prev) => ({ repository, items: prev.repository === repository ? prev.items : [], loadError: true }));
    }
  }, [repository]);

  useEffect(() => {
    let cancelled = false;
    repository
      .list()
      .then((items) => {
        if (!cancelled) setState({ repository, items, loadError: false });
      })
      .catch(() => {
        if (!cancelled) setState((prev) => ({ repository, items: prev.repository === repository ? prev.items : [], loadError: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const create = useCallback(
    async (item: T) => {
      const created = await repository.create(item);
      await refresh();
      return created;
    },
    [repository, refresh],
  );
  const update = useCallback(
    async (id: string, patch: Partial<T>) => {
      const updated = await repository.update(id, patch);
      await refresh();
      return updated;
    },
    [repository, refresh],
  );
  const remove = useCallback(
    async (id: string) => {
      await repository.remove(id);
      await refresh();
    },
    [repository, refresh],
  );
  const current = state.repository === repository;
  return { items: current ? state.items : [], loaded: current, loadError: current && state.loadError, refresh, create, update, remove };
}

export function useLeads(workspaceSlug: string) {
  return useWorkCollection<Lead>(useMemo(() => pick(workspaceSlug, getLeadsRepository, createRemoteLeadsRepository), [workspaceSlug]));
}
export function useQuotes(workspaceSlug: string) {
  return useWorkCollection<Quote>(useMemo(() => pick(workspaceSlug, getQuotesRepository, createRemoteQuotesRepository), [workspaceSlug]));
}
export function useJobs(workspaceSlug: string) {
  return useWorkCollection<Job>(useMemo(() => pick(workspaceSlug, getJobsRepository, createRemoteJobsRepository), [workspaceSlug]));
}
export function useProjects(workspaceSlug: string) {
  return useWorkCollection<Project>(useMemo(() => pick(workspaceSlug, getProjectsRepository, createRemoteProjectsRepository), [workspaceSlug]));
}
