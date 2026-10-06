import type { Repository } from "./types";
import type { ActionResult } from "@/server/actions/result";

/**
 * A failure reported by a server action (a conflict, missing permission,
 * invalid input…). `code` is stable and safe to branch on in the UI.
 */
export class RemoteActionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "RemoteActionError";
  }
}

export function unwrap<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new RemoteActionError(result.code, result.message);
  return result.data;
}

export interface RemoteAdapter<T extends { id: string }> {
  list(): Promise<ActionResult<T[]>>;
  create(item: T): Promise<ActionResult<T>>;
  update(id: string, patch: Partial<T>): Promise<ActionResult<T | undefined>>;
  remove(id: string): Promise<ActionResult<void>>;
}

/**
 * Repository for REAL workspaces: same contract as `createLocalRepository`,
 * but every call is a Server Action that runs validation, permissions,
 * business rules and the Supabase write on the server.
 */
export function createRemoteRepository<T extends { id: string }>(
  adapter: Partial<RemoteAdapter<T>> & Pick<RemoteAdapter<T>, "list">,
): Repository<T> {
  return {
    async list() {
      return unwrap(await adapter.list());
    },
    async get(id) {
      return (await this.list()).find((item) => item.id === id);
    },
    async create(item) {
      if (!adapter.create) throw new RemoteActionError("generic", "create is not supported");
      return unwrap(await adapter.create(item));
    },
    async update(id, patch) {
      if (!adapter.update) throw new RemoteActionError("generic", "update is not supported");
      return unwrap(await adapter.update(id, patch));
    },
    async remove(id) {
      if (!adapter.remove) throw new RemoteActionError("generic", "remove is not supported");
      unwrap(await adapter.remove(id));
    },
    async replaceAll() {
      throw new RemoteActionError("generic", "replaceAll is not supported");
    },
  };
}
