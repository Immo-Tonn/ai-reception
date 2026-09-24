import { getWorkspaceConfig } from "@/features/workspace/registry";
import type { IndustryKey } from "@/features/workspace/types";
import type { WorkspaceBranding } from "./types";

const primaryColorByIndustry: Record<IndustryKey, string> = {
  salon: "#c4568a",
  werkstatt: "#3a66e0",
  cleaning: "#2f9e60",
  consulting: "#6a4fd6",
};

/**
 * Placeholder until Settings has a real branding editor + logo upload —
 * but reads the ACTUAL workspace's own name/industry (not a single
 * hardcoded business), so a client booking with Werkstatt or Consulting
 * sees their own business, not "Anna's Beauty Studio" (§ Client side must
 * show the business name/branding of the workspace it opened).
 */
export function getWorkspaceBranding(workspaceSlug: string): WorkspaceBranding {
  const workspace = getWorkspaceConfig(workspaceSlug);
  return {
    businessName: workspace.name,
    logoInitial: workspace.emoji,
    primaryColor: primaryColorByIndustry[workspace.industry],
  };
}
