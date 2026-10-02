import type { WorkspaceConfig } from "./types";
import { salonWorkspace } from "./presets/salon";
import { werkstattWorkspace } from "./presets/werkstatt";
import { cleaningWorkspace } from "./presets/cleaning";
import { consultingWorkspace } from "./presets/consulting";

/** Every demo workspace, in switcher display order. */
export const demoWorkspaces: WorkspaceConfig[] = [
  salonWorkspace,
  werkstattWorkspace,
  cleaningWorkspace,
  consultingWorkspace,
];

const bySlug = new Map(demoWorkspaces.map((w) => [w.slug, w]));

/**
 * Resolves a `workspaceSlug` route param to its WorkspaceConfig. A slug
 * outside the four demo presets (i.e. a real workspace) gets an honest
 * EMPTY config — never Salon's demo data. Public routes use
 * `findWorkspaceConfig` and 404 instead.
 */
export function getWorkspaceConfig(workspaceSlug: string): WorkspaceConfig {
  return bySlug.get(workspaceSlug) ?? emptyWorkspaceConfig(workspaceSlug);
}

/** True for the four demo preset slugs only (local/demo data path). */
export function isDemoWorkspaceSlug(slug: string): boolean {
  return bySlug.has(slug);
}

/**
 * A real (non-demo) workspace has no demo catalog: it must never show
 * Salon's fake clients/appointments as if they were its own. Real data for
 * it comes from the database as each entity is migrated.
 */
function emptyWorkspaceConfig(slug: string): WorkspaceConfig {
  return {
    slug,
    industry: "consulting",
    name: slug,
    tagline: "",
    emoji: "\u{1F3E2}",
    services: [],
    staff: [],
    resources: [],
    clients: [],
    appointments: [],
  };
}

/**
 * Strict lookup: `undefined` for any slug that is not a known workspace.
 * Public routes (`/book/[workspaceSlug]`) must use this and 404 — falling
 * back to Salon there would show one business's catalog under another
 * business's URL. (`getWorkspaceConfig` keeps its fallback for the
 * authenticated app shell, which is demo-only until real workspaces exist.)
 */
export function findWorkspaceConfig(workspaceSlug: string): WorkspaceConfig | undefined {
  return bySlug.get(workspaceSlug);
}
