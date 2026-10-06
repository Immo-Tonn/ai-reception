import "server-only";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getSession } from "@/server/auth/session";
import { getServerWorkingHours } from "@/server/repository/workingHours";
import { listServices } from "@/server/services/services.service";
import { listStaff } from "@/server/services/staff.service";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { ResourceDefinition } from "@/features/resources/types";
import type { WorkingHoursProfile } from "@/features/workingHours/types";

/**
 * What the signed-in app screens (calendar, today, …) need to know about a
 * REAL workspace: its own services, specialists and working hours. Demo
 * workspaces return `null` — their screens keep reading the demo presets.
 */
export interface AppCatalog {
  services: ServiceDefinition[];
  staff: StaffMember[];
  resources: ResourceDefinition[];
  workingHours: WorkingHoursProfile[];
}

export async function loadAppCatalog(workspaceSlug: string): Promise<AppCatalog | null> {
  if (isDemoWorkspaceSlug(workspaceSlug)) return null;
  const session = await getSession(workspaceSlug);
  const [services, staff, workingHours] = await Promise.all([
    listServices(session),
    listStaff(session),
    getServerWorkingHours(session.workspaceId),
  ]);
  return { services, staff, resources: [], workingHours };
}
