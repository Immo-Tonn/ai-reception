import "server-only";
import type { Repository } from "@/lib/repository/types";

/**
 * In-memory "MockRepository" for the server layer (§5: "MockRepository
 * сейчас"). Distinct from the browser's localStorage repository — this
 * one lives in server memory and resets on server restart, which is
 * fine for a demo: the point is the *shape* (Repository<T>) is identical
 * to what a Supabase/Postgres adapter will implement later, so services
 * built against it don't change when the real adapter lands.
 *
 * Module-level Map = persists across requests within one server process
 * (dev server, or one serverless instance), not across deploys/restarts.
 */
export function createMockRepository<T extends { id: string }>(seed: T[]): Repository<T> {
  const store = new Map<string, T>(seed.map((item) => [item.id, item]));

  return {
    async list() {
      return Array.from(store.values());
    },
    async get(id) {
      return store.get(id);
    },
    async create(item) {
      store.set(item.id, item);
      return item;
    },
    async update(id, patch) {
      const existing = store.get(id);
      if (!existing) return undefined;
      const updated = { ...existing, ...patch };
      store.set(id, updated);
      return updated;
    },
    async remove(id) {
      store.delete(id);
    },
    async replaceAll(items) {
      store.clear();
      for (const item of items) store.set(item.id, item);
    },
  };
}
