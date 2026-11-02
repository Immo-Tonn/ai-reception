import "server-only";
import { z } from "zod";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { toRepositoryError } from "@/server/repository/errors";

/**
 * Export of ONE client's data (migration 0029). Owner / admin; internal notes only
 * for the owner. The database checks the same again and reads every row with the
 * caller's RLS. Nothing of the export is stored or logged — only the database
 * writes one audit entry with categories and counts. Mode "data_subject_request"
 * also records the request (metadata only) in data_subject_requests.
 *
 * The Art. 15 information block is a DRAFT: purposes, retention, recipients etc.
 * are placeholders until the legal wording is provided (Needs legal review).
 */

export const DSR_TYPES = ["access", "portability", "rectification", "erasure", "restriction", "objection"] as const;
export const DSR_STATUSES = ["open", "in_progress", "completed", "rejected"] as const;
export type DsrStatus = (typeof DSR_STATUSES)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const exportRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("admin"), includeInternalNotes: z.boolean().default(false) }),
  z.object({
    mode: z.literal("data_subject_request"),
    includeInternalNotes: z.boolean().default(false),
    request: z
      .object({
        type: z.enum(DSR_TYPES),
        receivedOn: isoDate,
        dueOn: isoDate,
        identityVerified: z.literal(true),
        status: z.enum(DSR_STATUSES).default("completed"),
      })
      .refine((r) => r.dueOn >= r.receivedOn),
  }),
]);
export type ExportRequest = z.input<typeof exportRequestSchema>;

/** Placeholder text — the lawyer provides the final wording. */
const LEGAL_PENDING = "Needs legal review";

type ExportPayload = { meta: { counts: Record<string, number> } } & Record<string, unknown>;

export async function exportClientData(session: Session, clientId: string, input: ExportRequest): Promise<Record<string, unknown>> {
  assertCan(session.role, "clients.export");
  const id = z.string().uuid().parse(clientId);
  const req = exportRequestSchema.parse(input);
  if (req.includeInternalNotes) assertCan(session.role, "clients.export_internal_notes");

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("export_client_data", {
    p_workspace_id: session.workspaceId,
    p_client_id: id,
    p_include_internal_notes: req.includeInternalNotes,
    p_mode: req.mode,
  });
  if (error) throw toRepositoryError(error, "clients.export");
  const payload = data as ExportPayload;
  if (req.mode === "admin") return payload;

  const categories = Object.entries(payload.meta.counts)
    .filter(([, n]) => n > 0)
    .map(([k]) => k);
  const { data: row, error: insertError } = await supabase
    .from("data_subject_requests")
    .insert({
      workspace_id: session.workspaceId,
      client_id: id,
      request_type: req.request.type,
      received_on: req.request.receivedOn,
      due_on: req.request.dueOn,
      status: req.request.status,
      identity_verified: true,
      responsible_profile_id: session.userId,
      exported_categories: categories,
      created_by: session.userId,
    })
    .select("id")
    .single();
  if (insertError) throw toRepositoryError(insertError, "dataSubjectRequests.create");

  return {
    ...payload,
    dataSubjectRequest: {
      status: "draft",
      notice: "Draft answer — legal wording pending. Not yet confirmed as a complete Art. 15 GDPR answer.",
      requestId: (row as { id: string }).id,
      type: req.request.type,
      receivedOn: req.request.receivedOn,
      dueOn: req.request.dueOn,
      identityVerified: true,
      dataCategories: categories,
      purposes: LEGAL_PENDING,
      legalBases: LEGAL_PENDING,
      recipients: LEGAL_PENDING,
      retentionPeriods: LEGAL_PENDING,
      source: LEGAL_PENDING,
      rights: LEGAL_PENDING,
    },
  };
}

export interface DataSubjectRequestRow {
  id: string;
  requestType: (typeof DSR_TYPES)[number];
  receivedOn: string;
  dueOn: string;
  status: DsrStatus;
  identityVerified: boolean;
  exportedCategories: string[];
  completedAt: string | null;
}

export async function listDataSubjectRequests(session: Session, clientId: string): Promise<DataSubjectRequestRow[]> {
  assertCan(session.role, "clients.export");
  const id = z.string().uuid().parse(clientId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("data_subject_requests")
    .select("id,request_type,received_on,due_on,status,identity_verified,exported_categories,completed_at")
    .eq("workspace_id", session.workspaceId)
    .eq("client_id", id)
    .order("received_on", { ascending: false })
    .limit(50);
  if (error) throw toRepositoryError(error, "dataSubjectRequests.list");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    requestType: r.request_type as DataSubjectRequestRow["requestType"],
    receivedOn: r.received_on as string,
    dueOn: r.due_on as string,
    status: r.status as DsrStatus,
    identityVerified: r.identity_verified as boolean,
    exportedCategories: (r.exported_categories as string[] | null) ?? [],
    completedAt: (r.completed_at as string | null) ?? null,
  }));
}

export async function setDataSubjectRequestStatus(session: Session, requestId: string, status: DsrStatus): Promise<void> {
  assertCan(session.role, "clients.export");
  const id = z.string().uuid().parse(requestId);
  const next = z.enum(DSR_STATUSES).parse(status);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("data_subject_requests")
    .update({ status: next })
    .eq("workspace_id", session.workspaceId)
    .eq("id", id)
    .select("id");
  if (error) throw toRepositoryError(error, "dataSubjectRequests.update");
  if (!data || data.length === 0) throw toRepositoryError({ code: "P0002" }, "dataSubjectRequests.update");
}
