import type { WorkspaceBranding } from "./types";

/**
 * Placeholder until Settings has a real branding editor + logo upload.
 * Keyed by workspace slug so the booking pages already read "per
 * workspace" config instead of a single hardcoded constant.
 */
export function getWorkspaceBranding(workspaceSlug: string): WorkspaceBranding {
  return {
    businessName: "Anna's Beauty Studio",
    logoInitial: workspaceSlug.slice(0, 1).toUpperCase(),
    primaryColor: "#3a66e0",
  };
}
