import "server-only";
import { z } from "zod";
import type { Session } from "@/server/auth/session";
import { can } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";
import { assertCanRead, assertCanWrite, audit } from "./schedulingShared";

/**
 * Client data retention period of the workspace (migration 0031,
 * workspaces.client_retention_months). PROVISIONAL (Needs legal review).
 * Owner and admin may read it (settings.manage); only the owner may change it
 * (retention.manage, re-checked by a database trigger). The value only feeds the
 * retention dry run — it never deletes or anonymises anything.
 */
export const RECOMMENDED_CLIENT_RETENTION_MONTHS = 36;
export const CLIENT_RETENTION_MIN_MONTHS = 12;
export const CLIENT_RETENTION_MAX_MONTHS = 120;

export const clientRetentionMonthsSchema = z
  .number()
  .int()
  .min(CLIENT_RETENTION_MIN_MONTHS)
  .max(CLIENT_RETENTION_MAX_MONTHS);

export interface RetentionSettings {
  clientRetentionMonths: number;
  recommendedMonths: number;
  minMonths: number;
  maxMonths: number;
  canEdit: boolean;
  /** Automatic anonymisation is not implemented / switched on in this stage. */
  autoAnonymizeActive: false;
  businessName: string;
}

function toSettings(session: Session, row: Record<string, unknown>): RetentionSettings {
  const months = row.client_retention_months;
  return {
    clientRetentionMonths: typeof months === "number" ? months : RECOMMENDED_CLIENT_RETENTION_MONTHS,
    recommendedMonths: RECOMMENDED_CLIENT_RETENTION_MONTHS,
    minMonths: CLIENT_RETENTION_MIN_MONTHS,
    maxMonths: CLIENT_RETENTION_MAX_MONTHS,
    canEdit: can(session.role, "retention.manage"),
    autoAnonymizeActive: false,
    businessName: (row.name as string) ?? "",
  };
}

export async function getRetentionSettings(session: Session): Promise<RetentionSettings> {
  assertCanRead(session, "settings.manage");
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("workspaces")
    .select("name,client_retention_months")
    .eq("id", session.workspaceId)
    .maybeSingle();
  if (error || !data) throw new RepositoryNotFoundError("retentionSettings.get");
  return toSettings(session, data as Record<string, unknown>);
}

export async function updateClientRetentionMonths(session: Session, input: number): Promise<RetentionSettings> {
  assertCanWrite(session, "retention.manage");
  const months = clientRetentionMonthsSchema.parse(input);
  const client = await createSupabaseServerClient();
  const { data, error } = await client
    .from("workspaces")
    .update({ client_retention_months: months, updated_at: new Date().toISOString() })
    .eq("id", session.workspaceId)
    .select("name,client_retention_months")
    .maybeSingle();
  if (error) throw toRepositoryError(error, "retentionSettings.update");
  if (!data) throw new RepositoryNotFoundError("retentionSettings.update");
  await audit(session, "updated", "workspace", session.workspaceId, `Client data retention period set to ${months} months`);
  return toSettings(session, data as Record<string, unknown>);
}
