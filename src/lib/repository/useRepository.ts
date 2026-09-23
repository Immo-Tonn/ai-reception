"use client";

import { useCallback, useEffect, useState } from "react";
import type { Repository } from "./types";

/**
 * Generic client hook over a Repository. Components use the per-feature
 * `use<Entity>` hook (which calls this) instead of talking to a
 * Repository — let alone localStorage — directly.
 */
export function useRepositoryCollection<T extends { id: string }>(
  repository: Repository<T>,
) {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const list = await repository.list();
    setItems(list);
    setLoaded(true);
  }, [repository]);

  // Re-fetch whenever `repository` itself changes (not just on mount) —
  // a per-feature `use<Entity>` hook builds a new Repository instance
  // when `workspaceSlug` changes, and the same component tree can stay
  // mounted across a client-side navigation between workspace slugs
  // (Next.js reuses the layout/page instance for a dynamic segment
  // change), so a mount-only effect would keep showing the previous
  // workspace's data. `loaded` resets too, so consumers gating on it
  // (e.g. ClientDetailView) don't flash stale content while this loads.
  useEffect(() => {
    setLoaded(false);
    refresh();
  }, [refresh]);

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

  return { items, loaded, refresh, create, update, remove };
}
