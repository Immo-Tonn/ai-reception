"use client";

import { useCallback, useEffect, useState } from "react";
import type { Repository } from "./types";
import { trackBusy } from "@/lib/ui/busy";

/**
 * Generic client hook over a Repository. Components use the per-feature
 * `use<Entity>` hook (which calls this) instead of talking to a
 * Repository — let alone localStorage — directly.
 */
export function useRepositoryCollection<T extends { id: string }>(
  repository: Repository<T>,
) {
  // Items are stored WITH the repository they came from: `loaded` is derived
  // (false right after the repository changes) and a late answer from a
  // previous repository can never overwrite the current one.
  const [state, setState] = useState<{ source: Repository<T> | null; items: T[] }>({ source: null, items: [] });
  const items = state.items;
  const loaded = state.source === repository;

  const refresh = useCallback(async () => {
    const list = await repository.list();
    setState({ source: repository, items: list });
  }, [repository]);

  // Re-fetch whenever `repository` itself changes (not just on mount) —
  // a per-feature `use<Entity>` hook builds a new Repository instance
  // when `workspaceSlug` changes, and the same component tree can stay
  // mounted across a client-side navigation between workspace slugs
  // (Next.js reuses the layout/page instance for a dynamic segment
  // change), so a mount-only effect would keep showing the previous
  // workspace's data. `loaded` is false until THIS repository answered, so
  // consumers gating on it (e.g. ClientDetailView) don't flash stale content.
  useEffect(() => {
    let cancelled = false;
    void repository.list().then((list) => {
      if (!cancelled) setState({ source: repository, items: list });
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  const create = useCallback(
    async (item: T) => {
      // The whole change (save + reload) shows the app-wide busy bar.
      return trackBusy(
        (async () => {
          const created = await repository.create(item);
          await refresh();
          return created;
        })(),
      );
    },
    [repository, refresh],
  );

  const update = useCallback(
    async (id: string, patch: Partial<T>) => {
      return trackBusy(
        (async () => {
          const updated = await repository.update(id, patch);
          await refresh();
          return updated;
        })(),
      );
    },
    [repository, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await trackBusy(
        (async () => {
          await repository.remove(id);
          await refresh();
        })(),
      );
    },
    [repository, refresh],
  );

  return { items, loaded, refresh, create, update, remove };
}
