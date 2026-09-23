import type { Repository } from "./types";

/**
 * localStorage-backed Repository. This is the ONLY file that touches
 * `window.localStorage` for entity data — features get a typed
 * Repository from a factory (e.g. `getAppointmentsRepository`) and
 * components get a `use<Entity>` hook wrapping it, never this directly.
 *
 * Safe to call during SSR: reads/writes no-op (return the in-memory seed)
 * until `window` exists, so server-rendered pages never crash; the client
 * hydrates real data in a `useEffect`.
 */
export function createLocalRepository<T extends { id: string }>(
  storageKey: string,
  seed: T[],
): Repository<T> {
  function readAll(): T[] {
    if (typeof window === "undefined") return seed;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw === null) {
        window.localStorage.setItem(storageKey, JSON.stringify(seed));
        return seed;
      }
      return JSON.parse(raw) as T[];
    } catch {
      return seed;
    }
  }

  function writeAll(items: T[]): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // Storage full or unavailable (private mode) — demo data stays
      // in-memory for the rest of the session instead of crashing.
    }
  }

  return {
    async list() {
      return readAll();
    },
    async get(id) {
      return readAll().find((item) => item.id === id);
    },
    async create(item) {
      const items = readAll();
      const next = [...items, item];
      writeAll(next);
      return item;
    },
    async update(id, patch) {
      const items = readAll();
      let updated: T | undefined;
      const next = items.map((item) => {
        if (item.id !== id) return item;
        updated = { ...item, ...patch };
        return updated;
      });
      writeAll(next);
      return updated;
    },
    async remove(id) {
      writeAll(readAll().filter((item) => item.id !== id));
    },
    async replaceAll(items) {
      writeAll(items);
    },
  };
}
