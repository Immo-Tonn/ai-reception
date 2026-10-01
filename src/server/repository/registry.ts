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
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSupabaseServicesRepository } from "./servicesSupabaseRepository";

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
// Real workspaces have no demo invoices/waiting-list entries of their
// own yet (Track B hasn't migrated these two entities to Supabase) — an
// unrecognized id (every real workspace) gets an empty list, never the
// demo presets' data.
export const getServerInvoicesRepository = registryFactory<Invoice>((id) =>
  isDemoWorkspaceSlug(id) ? demoInvoices : [],
);
export const getServerWaitingListRepository = registryFactory<WaitingListEntry>((id) =>
  isDemoWorkspaceSlug(id) ? demoWaitingList : [],
);

// Services: the four demo presets keep running on the in-memory mock
// repository (unchanged); every real workspace (an id that isn't one of
// the four demo slugs) is backed by the real `services` table in
// Supabase, scoped by workspace_id, via the service_role admin client.
const mockServicesRepository = registryFactory<ServiceDefinition>(
  (workspaceId) => getWorkspaceConfig(workspaceId).services,
);
export function getServerServicesRepository(workspaceId: string): Repository<ServiceDefinition> {
  if (isDemoWorkspaceSlug(workspaceId)) {
    return mockServicesRepository(workspaceId);
  }
  return getSupabaseServicesRepository(workspaceId);
}

export const getServerStaffRepository = registryFactory<StaffMember>(
  (workspaceId) => getWorkspaceConfig(workspaceId).staff,
);
export const getServerResourcesRepository = registryFactory<ResourceDefinition>(
  (workspaceId) => getWorkspaceConfig(workspaceId).resources,
);
export const getServerAuditLogRepository = registryFactory<AuditLogEntry>(() => []);
