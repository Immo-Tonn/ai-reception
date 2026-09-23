/**
 * Storage-agnostic repository contract. Every feature talks to its data
 * only through this interface (via a `use<Entity>` hook — never directly
 * to localStorage from a component). Swapping `createLocalRepository` for
 * a Supabase-backed implementation later means changing one factory per
 * entity, not the UI (§ demo persistence requirement).
 */
export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  create(item: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | undefined>;
  remove(id: string): Promise<void>;
  /** Replace the entire collection (bulk import, seed reset). */
  replaceAll(items: T[]): Promise<void>;
}
