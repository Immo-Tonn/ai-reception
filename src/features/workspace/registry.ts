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
 * True for the four demo preset slugs only. A real workspace's `id`
 * (passed here as a UUID for authenticated server calls, or its `slug`
 * for public/demo routes) never matches one of these — used to branch
 * between the demo/mock data path and a real Supabase-backed one (see
 * `src/server/repository/registry.ts`).
 */
export function isDemoWorkspaceSlug(id: string): boolean {
  return bySlug.has(id);
}

/**
 * Honest empty catalog/demo-content for a real workspace — no services,
 * staff, resources, clients or appointments have been created for it yet
 * in this engine (Track B is migrating these to Supabase entity by
 * entity; until an entity has its own real repository, this is what a
 * real workspace sees instead of someone else's demo data).
 */
function emptyWorkspaceConfig(slug: string): WorkspaceConfig {
  return {
    slug,
    industry: "consulting",
    name: slug,
    tagline: "",
    emoji: "\ud83c\udfe2",
    services: [],
    staff: [],
    resources: [],
    clients: [],
    appointments: [],
  };
}

/**
 * Resolves a `workspaceSlug` route param (or, for authenticated routes, a
 * real workspace's UUID) to its WorkspaceConfig. Unknown ids — every real
 * workspace created via signup — get an honest empty config, never a demo
 * preset's data: a new business must never see someone else's fake
 * invoices/appointments as if they were its own. Content only; every
 * screen still runs the one shared engine.
 */
export function getWorkspaceConfig(workspaceSlug: string): WorkspaceConfig {
  return bySlug.get(workspaceSlug) ?? emptyWorkspaceConfig(workspaceSlug);
}
