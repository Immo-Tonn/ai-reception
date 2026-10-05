import "server-only";
import type { Session } from "@/server/auth/session";
import { can, PermissionDeniedError } from "@/server/permissions/roles";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RepositoryError, RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";
import { analyticsRangeSchema, type AnalyticsRangeInput } from "@/server/validation/analytics.schema";
import { mapAnalyticsOverview, type AnalyticsOverview } from "@/features/analytics/overview";

/**
 * Analytics for REAL workspaces: one call to the SECURITY INVOKER SQL function `analytics_overview`
 * (migration 0024) through the USER-SCOPED client (never the service role). Row Level Security therefore
 * applies to every row that is aggregated, so a total can never include what the caller may not read
 * (private bucket, owner_only / private visibility, ...). The function omits the sections the caller lacks
 * permission for (revenue without finance.view), so those numbers never reach the browser either.
 *
 * Demo workspaces keep the pure calculations (src/features/analytics/calculations.ts) in the browser; this
 * service refuses them and never touches the database for them.
 */
export async function getAnalyticsOverview(session: Session, input: AnalyticsRangeInput): Promise<AnalyticsOverview> {
  if (!can(session.role, "appointments.view") && !can(session.role, "clients.view") && !can(session.role, "finance.view")) {
    throw new PermissionDeniedError(session.role, "appointments.view");
  }
  const range = analyticsRangeSchema.parse(input);
  if (isDemoWorkspaceSlug(session.workspaceId)) throw new RepositoryNotFoundError("analytics.overview");

  const client = await createSupabaseServerClient();
  const { data, error } = await client.rpc("analytics_overview", {
    p_workspace_id: session.workspaceId,
    p_from: range.from,
    p_to: range.to,
  });
  if (error) throw toRepositoryError(error, "analytics.overview");
  if (!data || typeof data !== "object") throw new RepositoryError("analytics.overview");
  return mapAnalyticsOverview(data, can(session.role, "financial_bucket.private.view"));
}
