import "server-only";
import { createMockRepository } from "./mockRepository";
import type { Repository } from "@/lib/repository/types";
import type { Appointment } from "@/features/appointments/types";
import type { ClientRecord } from "@/features/clients/types";
import type { Invoice } from "@/features/finance/types";
import type { WaitingListEntry } from "@/features/waitingList/types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { AuditLogEntry } from "@/features/auditLog/types";
import { demoInvoices } from "@/features/finance/demoData";
import { demoWaitingList } from "@/features/waitingList/demoData";
import { getWorkspaceConfig } from "@/features/workspace/registry";

/**
 * One mock repository instance per (workspace, entity), created lazily
 * and cached for the life of the server process — mirrors how a real
 * Supabase client would be scoped per workspace via `workspace_id`.
 * `seed` is resolved per-workspace (not a single fixed array) so Public
 * Booking and Server Actions see the same per-industry catalog/demo data
 * as the authenticated app for the same slug — one engine, one registry,
 * only the WorkspaceConfig differs.
 */
function registryFactory<T extends { id: string }>(seed: (workspaceId: string) => T[]) {
  const cache = new Map<string, Repository<T>>();
  return (workspaceId: string): Repository<T> => {
    let repo = cache.get(workspaceId);
    if (!repo) {
      repo = createMockRepository<T>(seed(workspaceId).map((item) => ({ ...item })));
      cache.set(workspaceId, repo);
    }
    return repo;
  };
}

export const getServerAppointmentsRepository = registryFactory<Appointment>(
  (workspaceId) => getWorkspaceConfig(workspaceId).appointments,
);
export const getServerClientsRepository = registryFactory<ClientRecord>(
  (workspaceId) => getWorkspaceConfig(workspaceId).clients,
);
export const getServerInvoicesRepository = registryFactory<Invoice>(() => demoInvoices);
export const getServerWaitingListRepository = registryFactory<WaitingListEntry>(
  () => demoWaitingList,
);
export const getServerServicesRepository = registryFactory<ServiceDefinition>(
  (workspaceId) => getWorkspaceConfig(workspaceId).services,
);
export const getServerStaffRepository = registryFactory<StaffMember>(
  (workspaceId) => getWorkspaceConfig(workspaceId).staff,
);
export const getServerResourcesRepository = registryFactory<ResourceDefinition>(
  (workspaceId) => getWorkspaceConfig(workspaceId).resources,
);
export const getServerAuditLogRepository = registryFactory<AuditLogEntry>(() => []);
