import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import type { Repository } from "@/lib/repository/types";
import type { Appointment } from "./types";
import { getWorkspaceConfig } from "@/features/workspace/registry";

const cache = new Map<string, Repository<Appointment>>();

export function getAppointmentsRepository(workspaceSlug: string): Repository<Appointment> {
  const key = `serviceos:${workspaceSlug}:appointments`;
  let repository = cache.get(key);
  if (!repository) {
    repository = createLocalRepository<Appointment>(key, getWorkspaceConfig(workspaceSlug).appointments);
    cache.set(key, repository);
  }
  return repository;
}
