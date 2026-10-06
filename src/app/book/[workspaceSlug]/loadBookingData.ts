import "server-only";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { getWorkspaceBranding } from "@/features/branding/demoData";
import type { WorkspaceBranding } from "@/features/branding/types";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import {
  getBookingPageInfoAction,
  listBookableServicesAction,
  listBookableStaffAction,
} from "@/server/actions/booking.actions";

export interface BookingPageData {
  mode: "demo" | "real";
  services: ServiceDefinition[];
  staffList: StaffMember[];
  branding: WorkspaceBranding;
}

const DEFAULT_PRIMARY = "#3a66e0";

/** Data for the public booking page; `null` = no such booking page. */
export async function loadBookingPageData(workspaceSlug: string): Promise<BookingPageData | null> {
  if (isDemoWorkspaceSlug(workspaceSlug)) {
    const workspace = getWorkspaceConfig(workspaceSlug);
    return {
      mode: "demo",
      services: workspace.services,
      staffList: workspace.staff,
      branding: getWorkspaceBranding(workspaceSlug),
    };
  }

  const info = await getBookingPageInfoAction(workspaceSlug);
  if (!info) return null;
  const [services, staffList] = await Promise.all([
    listBookableServicesAction(workspaceSlug),
    listBookableStaffAction(workspaceSlug),
  ]);
  return {
    mode: "real",
    services,
    staffList,
    branding: {
      businessName: info.name,
      logoInitial: info.name.trim().charAt(0).toUpperCase() || "•",
      primaryColor: DEFAULT_PRIMARY,
    },
  };
}
