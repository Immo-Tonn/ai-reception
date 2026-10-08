"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getWaitingListRepository } from "./repository";
import type { WaitingListEntry } from "./types";

/**
 * Waiting list of the workspace (local fixtures for demo, shared database for real workspaces).
 * `error` is set when loading failed (real backend errors are shown, never hidden behind an empty list).
 */
export function useWaitingList(workspaceSlug: string) {
  const repository = useMemo(() => getWaitingListRepository(workspaceSlug), [workspaceSlug]);
  const [items, setItems] = useState<WaitingListEntry[]>([]);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tick, setTick] = useState(0);
  const refresh = useCallback(async () => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    repository
      .list()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setError(null);
        setLoadedKey(workspaceSlug);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "unknown");
        setLoadedKey(workspaceSlug);
      });
    return () => {
      cancelled = true;
    };
  }, [repository, workspaceSlug, tick]);

  const create = useCallback(
    async (item: WaitingListEntry) => {
      const created = await repository.create(item);
      await refresh();
      return created;
    },
    [repository, refresh],
  );
  const update = useCallback(
    async (id: string, patch: Partial<WaitingListEntry>) => {
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

  // Loaded only for the workspace being shown (a slug change starts as "loading" again).
  const loaded = loadedKey === workspaceSlug;
  return { items, loaded, error, refresh, create, update, remove };
}
