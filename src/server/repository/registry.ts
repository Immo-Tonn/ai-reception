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
import { createSupabaseServicesRepository } from "./servicesSupabaseRepository";
import { createSupabaseAppointmentsRepository } from "./appointmentsSupabaseRepository";
import { createSupabaseClientsRepository } from "./clientsSupabaseRepository";
import {
  createSupabaseAuditLogRepository,
  createSupabaseResourcesRepository,
  createSupabaseStaffRepository,
} from "./catalogSupabaseRepositories";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import { workingHoursFromRows, type WorkingHoursRow } from "@/server/booking/workingHoursMapper";
import { toRepositoryError } from "./errors";

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
    // This in-memory mock is DEMO-ONLY. A real workspace must never fall
    // through to it: writes would vanish on the next lambda and, worse,
    // pretend to succeed. Each entity gets a real adapter in its own phase;
    // until then it fails loudly.
    if (!isDemoWorkspaceSlug(workspaceId)) {
      throw new Error("This entity is not available for real workspaces yet.");
    }
    let repo = cache.get(workspaceId);
    if (!repo) {
      repo = createMockRepository<T>(seed(workspaceId).map((item) => ({ ...item })));
      cache.set(workspaceId, repo);
    }
    return repo;
  };
}

const mockAppointmentsRepository = registryFactory<Appointment>(
  (workspaceId) => getWorkspaceConfig(workspaceId).appointments,
);

export function getServerAppointmentsRepository(workspaceId: string): Repository<Appointment> {
  return isDemoWorkspaceSlug(workspaceId) ? mockAppointmentsRepository(workspaceId) : createSupabaseAppointmentsRepository(workspaceId);
}
const mockClientsRepository = registryFactory<ClientRecord>(
  (workspaceId) => getWorkspaceConfig(workspaceId).clients,
);

export function getServerClientsRepository(workspaceId: string): Repository<ClientRecord> {
  return isDemoWorkspaceSlug(workspaceId) ? mockClientsRepository(workspaceId) : createSupabaseClientsRepository(workspaceId);
}
export const getServerInvoicesRepository = registryFactory<Invoice>(() => demoInvoices);
export const getServerWaitingListRepository = registryFactory<WaitingListEntry>(
  () => demoWaitingList,
);
const mockServicesRepository = registryFactory<ServiceDefinition>(
  (workspaceId) => getWorkspaceConfig(workspaceId).services,
);

/** Demo workspaces: in-memory mock. Real workspaces: Supabase, as the signed-in user (RLS). */
export function getServerServicesRepository(workspaceId: string): Repository<ServiceDefinition> {
  return isDemoWorkspaceSlug(workspaceId)
    ? mockServicesRepository(workspaceId)
    : createSupabaseServicesRepository(workspaceId);
}
const mockStaffRepository = registryFactory<StaffMember>(
  (workspaceId) => getWorkspaceConfig(workspaceId).staff,
);

export function getServerStaffRepository(workspaceId: string): Repository<StaffMember> {
  return isDemoWorkspaceSlug(workspaceId) ? mockStaffRepository(workspaceId) : createSupabaseStaffRepository(workspaceId);
}
const mockResourcesRepository = registryFactory<ResourceDefinition>(
  (workspaceId) => getWorkspaceConfig(workspaceId).resources,
);

export function getServerResourcesRepository(workspaceId: string): Repository<ResourceDefinition> {
  return isDemoWorkspaceSlug(workspaceId) ? mockResourcesRepository(workspaceId) : createSupabaseResourcesRepository(workspaceId);
}
const mockAuditLogRepository = registryFactory<AuditLogEntry>(() => []);

export function getServerAuditLogRepository(workspaceId: string): Repository<AuditLogEntry> {
  return isDemoWorkspaceSlug(workspaceId) ? mockAuditLogRepository(workspaceId) : createSupabaseAuditLogRepository(workspaceId);
}

/**
 * Working hours for the availability rules. Demo: the shared demo schedule.
 * Real workspace: the `working_hours` rows, read as the signed-in user (RLS).
 */
export async function getServerWorkingHours(workspaceId: string): Promise<WorkingHoursProfile[]> {
  if (isDemoWorkspaceSlug(workspaceId)) return demoWorkingHours;
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("working_hours")
    .select("staff_id,weekday,start_time,end_time,is_day_off")
    .eq("workspace_id", workspaceId);
  if (error) throw toRepositoryError(error, "workingHours.list");
  return workingHoursFromRows((data as WorkingHoursRow[]) ?? []);
}
