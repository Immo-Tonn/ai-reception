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
 * Resolves a `workspaceSlug` route param to its WorkspaceConfig. Unknown
 * slugs (a real workspace created later, or any slug outside the four
 * demo presets) fall back to Salon so the app never breaks — the fallback
 * is content only, every screen still runs the one shared engine.
 */
export function getWorkspaceConfig(workspaceSlug: string): WorkspaceConfig {
  return bySlug.get(workspaceSlug) ?? salonWorkspace;
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
