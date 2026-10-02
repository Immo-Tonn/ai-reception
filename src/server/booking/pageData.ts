import "server-only";
import { notFound } from "next/navigation";
import { findWorkspaceConfig } from "@/features/workspace/registry";
import { getWorkspaceBranding } from "@/features/branding/demoData";
import type { WorkspaceBranding } from "@/features/branding/types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadPublicCatalog } from "./publicBooking.service";

export interface PublicPageData {
  branding: WorkspaceBranding;
  services: ServiceDefinition[];
  staff: StaffMember[];
}

const DEFAULT_COLOR = "#6a4fd6";

/**
 * Everything the public booking page (and the embed) needs about a workspace.
 * Demo workspaces: built-in preset, no backend. Any other slug: the database
 * (public-safe facts only, via the guest catalog function). Unknown slug, or a
 * real slug while Supabase is not configured: 404 — never another business's
 * catalog.
 */
export async function loadPublicPageData(slug: string): Promise<PublicPageData> {
  const demo = findWorkspaceConfig(slug);
  if (demo) return { branding: getWorkspaceBranding(slug), services: demo.services, staff: demo.staff };

  if (!isSupabaseConfigured()) notFound();
  const catalog = await loadPublicCatalog({ admin: createSupabaseAdminClient() }, slug).catch(() => null);
  if (!catalog) notFound();

  return {
    branding: {
      businessName: catalog.workspace.name,
      logoInitial: [...catalog.workspace.name][0]?.toUpperCase() ?? "S",
      primaryColor: DEFAULT_COLOR,
    },
    services: catalog.services,
    staff: catalog.staff,
  };
}
