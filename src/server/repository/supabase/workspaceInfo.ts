import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export interface WorkspaceInfo {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
}

const TTL_MS = 30_000;
const byId = new Map<string, { at: number; info: WorkspaceInfo | null }>();
const bySlug = new Map<string, { at: number; info: WorkspaceInfo | null }>();

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  default_currency: string;
}

function fromRow(row: WorkspaceRow): WorkspaceInfo {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    timezone: row.timezone,
    currency: row.default_currency,
  };
}

function remember(info: WorkspaceInfo) {
  const entry = { at: Date.now(), info };
  byId.set(info.id, entry);
  bySlug.set(info.slug, entry);
}

/** Workspace facts every Supabase repository needs (time zone, name). */
export async function getWorkspaceInfo(workspaceId: string): Promise<WorkspaceInfo> {
  const cached = byId.get(workspaceId);
  if (cached && cached.info && Date.now() - cached.at < TTL_MS) return cached.info;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("workspaces")
    .select("id, slug, name, timezone, default_currency")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Workspace not found.");
  const info = fromRow(data as WorkspaceRow);
  remember(info);
  return info;
}

/**
 * Public (no session) slug -> workspace lookup, used by the unauthenticated
 * booking page. Returns null for an unknown slug instead of throwing, so a
 * mistyped booking link renders a normal "not found" state.
 */
export async function findWorkspaceBySlug(slug: string): Promise<WorkspaceInfo | null> {
  const cached = bySlug.get(slug);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.info;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("workspaces")
    .select("id, slug, name, timezone, default_currency")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    bySlug.set(slug, { at: Date.now(), info: null });
    return null;
  }
  const info = fromRow(data as WorkspaceRow);
  remember(info);
  return info;
}
