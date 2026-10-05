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
import { createSupabaseInvoicesRepository } from "./invoicesSupabaseRepository";
import { withDemoInvoiceOps } from "@/features/finance/demoOps";
import type { InvoicesRepository } from "@/features/finance/types";
import { createSupabaseWaitingListRepository } from "./waitingListSupabaseRepository";
import { createSupabaseInboxEventsRepository, type InboxEventsRepository } from "./inboxEventsSupabaseRepository";
import {
  createSupabaseAuditLogRepository,
  createSupabaseResourcesRepository,
  createSupabaseStaffRepository,
} from "./catalogSupabaseRepositories";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Job, Lead, Project, Quote } from "@/features/work/types";
import { demoJobs, demoLeads, demoProjects, demoQuotes } from "@/features/work/demoData";
import {
  createSupabaseJobsRepository,
  createSupabaseLeadsRepository,
  createSupabaseProjectsRepository,
  createSupabaseQuotesRepository,
  createSupabaseWorkOps,
  type WorkOps,
} from "./workSupabaseRepositories";
import { createDemoWorkOps } from "./workDemoOps";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import type { ScheduleMode, TimeOffEntry } from "@/features/scheduling/types";
import { workingHoursFromRows, type WorkingHoursRow } from "@/server/booking/workingHoursMapper";
import { RepositoryConflictError, toRepositoryError } from "./errors";

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
const mockInvoicesRepository = registryFactory<Invoice>(() => demoInvoices);

/** Demo workspaces: in-memory mock (+ payment ops). Real workspaces: Supabase as the signed-in user (RLS). */
export function getServerInvoicesRepository(workspaceId: string): InvoicesRepository {
  return isDemoWorkspaceSlug(workspaceId)
    ? withDemoInvoiceOps(mockInvoicesRepository(workspaceId), () => new RepositoryConflictError("invoices"))
    : createSupabaseInvoicesRepository(workspaceId);
}
const mockWaitingListRepository = registryFactory<WaitingListEntry>(() => demoWaitingList);

/** Demo workspaces: in-memory mock. Real workspaces: Supabase, as the signed-in user (RLS). */
export function getServerWaitingListRepository(workspaceId: string): Repository<WaitingListEntry> {
  return isDemoWorkspaceSlug(workspaceId)
    ? mockWaitingListRepository(workspaceId)
    : createSupabaseWaitingListRepository(workspaceId);
}

/** Inbox events exist for REAL workspaces only (demo keeps its Conversation fixtures). */
export function getServerInboxEventsRepository(workspaceId: string): InboxEventsRepository {
  if (isDemoWorkspaceSlug(workspaceId)) throw new Error("Inbox events are not available for demo workspaces.");
  return createSupabaseInboxEventsRepository(workspaceId);
}
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
// Work pipeline (migration 0021): demo = in-memory mock (demo-* slugs only), real = Supabase under RLS.
const mockLeadsRepository = registryFactory<Lead>(() => demoLeads);
const mockQuotesRepository = registryFactory<Quote>(() => demoQuotes);
const mockJobsRepository = registryFactory<Job>(() => demoJobs);
const mockProjectsRepository = registryFactory<Project>(() => demoProjects);

export function getServerLeadsRepository(workspaceId: string): Repository<Lead> {
  return isDemoWorkspaceSlug(workspaceId) ? mockLeadsRepository(workspaceId) : createSupabaseLeadsRepository(workspaceId);
}
export function getServerQuotesRepository(workspaceId: string): Repository<Quote> {
  return isDemoWorkspaceSlug(workspaceId) ? mockQuotesRepository(workspaceId) : createSupabaseQuotesRepository(workspaceId);
}
export function getServerJobsRepository(workspaceId: string): Repository<Job> {
  return isDemoWorkspaceSlug(workspaceId) ? mockJobsRepository(workspaceId) : createSupabaseJobsRepository(workspaceId);
}
export function getServerProjectsRepository(workspaceId: string): Repository<Project> {
  return isDemoWorkspaceSlug(workspaceId) ? mockProjectsRepository(workspaceId) : createSupabaseProjectsRepository(workspaceId);
}
/** Atomic, idempotent conversions (lead -> quote -> job / project). */
export function getServerWorkOps(workspaceId: string): WorkOps {
  if (!isDemoWorkspaceSlug(workspaceId)) return createSupabaseWorkOps();
  return createDemoWorkOps({
    leads: mockLeadsRepository(workspaceId),
    quotes: mockQuotesRepository(workspaceId),
    jobs: mockJobsRepository(workspaceId),
    projects: mockProjectsRepository(workspaceId),
  });
}

const mockAuditLogRepository = registryFactory<AuditLogEntry>(() => []);

export function getServerAuditLogRepository(workspaceId: string): Repository<AuditLogEntry> {
  return isDemoWorkspaceSlug(workspaceId) ? mockAuditLogRepository(workspaceId) : createSupabaseAuditLogRepository(workspaceId);
}

/** Rows of `time_off` -> business-side entries (with the private reason). */
function timeOffEntries(rows: TimeOffDbRow[]): TimeOffEntry[] {
  return rows.map((r) => ({
    id: r.id,
    staffId: r.staff_id,
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
    startTime: r.start_time ? String(r.start_time).slice(0, 5) : null,
    endTime: r.end_time ? String(r.end_time).slice(0, 5) : null,
    ...(r.reason ? { reason: r.reason } : {}),
  }));
}

interface TimeOffDbRow {
  id: string;
  staff_id: string | null;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason?: string | null;
}

export interface ServerScheduling {
  workingHours: WorkingHoursProfile[];
  timeOff: TimeOffEntry[];
}

/**
 * Everything the availability rules need for a workspace: working hours (several
 * intervals, day-off rows), time off / closures and per-staff schedule modes.
 * Demo: the shared demo schedule. Real workspace: read as the signed-in user (RLS).
 * Databases that do not have migration 0019 yet (no `time_off`, no `schedule_mode`)
 * keep working: those parts are simply empty.
 */
export async function getServerScheduling(workspaceId: string): Promise<ServerScheduling> {
  if (isDemoWorkspaceSlug(workspaceId)) return { workingHours: demoWorkingHours, timeOff: [] };
  const client = await createSupabaseServerClient();
  const [hours, timeOff, staff] = await Promise.all([
    client.from("working_hours").select("staff_id,weekday,start_time,end_time,is_day_off").eq("workspace_id", workspaceId),
    client.from("time_off").select("*").eq("workspace_id", workspaceId),
    client.from("staff_profiles").select("*").eq("workspace_id", workspaceId).eq("active", true),
  ]);
  if (hours.error) throw toRepositoryError(hours.error, "workingHours.list");
  const offRows = timeOff.error ? [] : ((timeOff.data as TimeOffDbRow[]) ?? []);
  const staffModes: Record<string, ScheduleMode> = {};
  for (const row of (staff.error ? [] : ((staff.data as { id: string; schedule_mode?: string }[]) ?? []))) {
    if (row.schedule_mode === "inherit" || row.schedule_mode === "custom") staffModes[row.id] = row.schedule_mode;
  }
  return {
    workingHours: workingHoursFromRows(
      (hours.data as WorkingHoursRow[]) ?? [],
      offRows.map((r) => ({
        staff_id: r.staff_id,
        start_date: String(r.start_date).slice(0, 10),
        end_date: String(r.end_date).slice(0, 10),
        start_time: r.start_time,
        end_time: r.end_time,
        reason: r.reason,
      })),
      staffModes,
    ),
    timeOff: timeOffEntries(offRows),
  };
}

/** Working hours (incl. time off and modes) for the availability rules. */
export async function getServerWorkingHours(workspaceId: string): Promise<WorkingHoursProfile[]> {
  return (await getServerScheduling(workspaceId)).workingHours;
}
