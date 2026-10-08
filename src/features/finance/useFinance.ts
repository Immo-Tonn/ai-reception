"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RemoteRepositoryError } from "@/lib/repository/createRemoteRepository";
import { getFinanceBackend, type FinanceBackend, type FinanceCapabilities } from "./financeBackend";
import type { Invoice } from "./types";

const NO_CAPABILITIES: FinanceCapabilities = { canEdit: false, canUsePrivateBucket: false };

/**
 * Finance screen state for BOTH worlds (real workspace: server actions; demo: local). Loading and a load
 * error are explicit — a real workspace never silently falls back to demo data. Mutations rethrow with a
 * stable code (RemoteRepositoryError) so the sheets can show SaveStatus errors; the list refreshes after
 * each successful change.
 */
export function useFinance(workspaceSlug: string) {
  const backend: FinanceBackend = useMemo(() => getFinanceBackend(workspaceSlug), [workspaceSlug]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [capabilities, setCapabilities] = useState<FinanceCapabilities>(NO_CAPABILITIES);
  // `loadedFor` instead of a boolean: switching workspace makes `loaded` false again without a setState in an effect.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loaded = loadedFor === workspaceSlug;
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await backend.load();
      setInvoices(data.invoices);
      setCapabilities(data.capabilities);
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof RemoteRepositoryError ? error.code : "unknown");
    } finally {
      setLoadedFor(workspaceSlug);
    }
  }, [backend, workspaceSlug]);

  // Initial / workspace-change load (state is set in promise callbacks, with a stale-response guard).
  useEffect(() => {
    let cancelled = false;
    backend
      .load()
      .then((data) => {
        if (cancelled) return;
        setInvoices(data.invoices);
        setCapabilities(data.capabilities);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof RemoteRepositoryError ? error.code : "unknown");
      })
      .finally(() => {
        if (!cancelled) setLoadedFor(workspaceSlug);
      });
    return () => {
      cancelled = true;
    };
  }, [backend, workspaceSlug]);

  const after = useCallback(
    async <T,>(work: Promise<T>): Promise<T> => {
      const result = await work;
      await refresh();
      return result;
    },
    [refresh],
  );

  return {
    invoices,
    capabilities,
    loaded,
    loadError,
    refresh,
    create: useCallback((d: Parameters<FinanceBackend["create"]>[0]) => after(backend.create(d)), [backend, after]),
    update: useCallback((id: string, p: Parameters<FinanceBackend["update"]>[1]) => after(backend.update(id, p)), [backend, after]),
    recordPayment: useCallback((id: string, p: Parameters<FinanceBackend["recordPayment"]>[1]) => after(backend.recordPayment(id, p)), [backend, after]),
    issue: useCallback((id: string) => after(backend.issue(id)), [backend, after]),
    markUnpaid: useCallback((id: string) => after(backend.markUnpaid(id)), [backend, after]),
    cancel: useCallback((id: string) => after(backend.cancel(id)), [backend, after]),
  };
}
