import "server-only";
import { getSession } from "@/server/auth/session";
import { can } from "@/server/permissions/roles";

/** Only shows / hides the export controls; the route, the service and the database enforce it. */
export async function getExportPermissions(workspaceSlug: string): Promise<{ canExport: boolean; canExportInternalNotes: boolean }> {
  try {
    const { role } = await getSession(workspaceSlug);
    return { canExport: can(role, "clients.export"), canExportInternalNotes: can(role, "clients.export_internal_notes") };
  } catch {
    return { canExport: false, canExportInternalNotes: false };
  }
}
