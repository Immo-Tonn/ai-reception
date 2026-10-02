import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Appointment } from "./types";
import { backfillAppointmentIds } from "./identity";
import { getWorkspaceConfig } from "@/features/workspace/registry";

const cache = new Map<string, Repository<Appointment>>();

/**
 * Local/demo adapter. Reads backfill `staffId`/`serviceId` (from the
 * workspace catalog, by display name) on legacy records saved before those
 * fields existed — in memory only, stored data is never rewritten, so old
 * localStorage data keeps working and nothing is lost on rollback. The
 * shared backend must do this backfill as a real migration.
 */
export function getAppointmentsRepository(workspaceSlug: string): Repository<Appointment> {
  const key = `serviceos:${workspaceSlug}:appointments`;
  let repository = cache.get(key);
  if (!repository) {
    const workspace = getWorkspaceConfig(workspaceSlug);
    const base = createLocalRepository<Appointment>(key, workspace.appointments);
    const withIds = (item: Appointment) => backfillAppointmentIds(item, workspace);
    repository = {
      ...base,
      list: async () => (await base.list()).map(withIds),
      get: async (id) => {
        const item = await base.get(id);
        return item ? withIds(item) : undefined;
      },
    };
    cache.set(key, repository);
  }
  return repository;
}
