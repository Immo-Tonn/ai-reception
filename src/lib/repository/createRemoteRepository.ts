import type { Repository } from "./types";

/**
 * Client-side adapter that makes a set of Server Actions look like a
 * `Repository<T>`. Screens (via the `use<Entity>` hooks) keep talking to the
 * ONE repository interface; whether the data lives in this browser (demo) or
 * in the shared database (real workspace) is decided by the per-feature
 * factory, not by the UI.
 *
 * Actions return `{ ok, data } | { ok: false, code }` — never raw errors. A
 * failure is rethrown here as `RemoteRepositoryError` carrying only the code,
 * so callers (e.g. the appointment sheet's "could not save") can react.
 */
export type RemoteResult<T> = { ok: true; data: T } | { ok: false; code: string };

export class RemoteRepositoryError extends Error {
  constructor(public code: string) {
    super(`Request failed: ${code}`);
    this.name = "RemoteRepositoryError";
  }
}

export interface RemoteOperations<T extends { id: string }> {
  list: () => Promise<RemoteResult<T[]>>;
  get?: (id: string) => Promise<RemoteResult<T | undefined>>;
  create: (item: T) => Promise<RemoteResult<T>>;
  update: (id: string, patch: Partial<T>) => Promise<RemoteResult<T | undefined>>;
  remove?: (id: string) => Promise<RemoteResult<unknown>>;
}

function unwrap<R>(result: RemoteResult<R>): R {
  if (!result.ok) throw new RemoteRepositoryError(result.code);
  return result.data;
}

export function createRemoteRepository<T extends { id: string }>(ops: RemoteOperations<T>): Repository<T> {
  return {
    async list() {
      return unwrap(await ops.list());
    },
    async get(id) {
      if (ops.get) return unwrap(await ops.get(id));
      return (unwrap(await ops.list())).find((item) => item.id === id);
    },
    async create(item) {
      return unwrap(await ops.create(item));
    },
    async update(id, patch) {
      return unwrap(await ops.update(id, patch));
    },
    async remove(id) {
      if (!ops.remove) throw new RemoteRepositoryError("unsupported");
      unwrap(await ops.remove(id));
    },
    async replaceAll() {
      throw new RemoteRepositoryError("unsupported");
    },
  };
}
