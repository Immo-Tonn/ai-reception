import "server-only";
import type { Session } from "@/server/auth/session";
import {
  getServerResourcesRepository,
  getServerServicesRepository,
  getServerStaffRepository,
  getServerWorkingHours,
} from "@/server/repository/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkspaceCatalogData } from "@/features/workspace/WorkspaceCatalog";

/**
 * Catalog of a REAL workspace for the business screens (services, staff,
 * resources, working hours, name, time zone) — read as the signed-in user
 * under Row Level Security.
 */
export async function loadWorkspaceCatalog(session: Session, slug: string): Promise<WorkspaceCatalogData> {
  const client = await createSupabaseServerClient();
  const [workspace, services, staff, resources, workingHours] = await Promise.all([
    client.from("workspaces").select("name,timezone").eq("id", session.workspaceId).maybeSingle(),
    getServerServicesRepository(session.workspaceId).list(),
    getServerStaffRepository(session.workspaceId).list(),
    getServerResourcesRepository(session.workspaceId).list(),
    getServerWorkingHours(session.workspaceId),
  ]);
  return {
    slug,
    name: (workspace.data?.name as string | undefined) ?? slug,
    timezone: (workspace.data?.timezone as string | undefined) ?? "Europe/Berlin",
    // Archived services are not offered for new appointments; old appointments keep their name.
    services: services.filter((s) => s.active !== false),
    staff,
    resources,
    workingHours,
  };
}
