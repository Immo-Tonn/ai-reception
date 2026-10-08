import { createRemoteRepository } from "@/lib/repository/createRemoteRepository";
import type { Repository } from "@/lib/repository/types";
import { createClientAction, getClientAction, listClientsAction, updateClientAction } from "@/server/actions/clients.actions";
import type { ClientRecord } from "./types";

/** Clients of a REAL workspace: Server Actions over the shared database (the same rows Public Booking creates). */
export function createRemoteClientsRepository(workspaceSlug: string): Repository<ClientRecord> {
  return createRemoteRepository<ClientRecord>({
    list: () => listClientsAction(workspaceSlug),
    get: (id) => getClientAction(workspaceSlug, id),
    create: (item) =>
      createClientAction(workspaceSlug, {
        name: item.name,
        email: item.email,
        phone: item.phone,
        tags: item.tags,
        notes: item.notes,
      }),
    update: (id, patch) =>
      updateClientAction(workspaceSlug, id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      }),
  });
}
