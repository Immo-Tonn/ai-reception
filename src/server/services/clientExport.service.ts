import "server-only";
import { z } from "zod";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RepositoryNotFoundError, toRepositoryError } from "@/server/repository/errors";

/**
 * Export of ONE client's data (migration 0029). Owner / admin; internal notes only
 * for the owner. The database checks the same again and reads every row with the
 * caller's RLS. Nothing of the export is stored or logged — only the database
 * writes one audit entry with categories and counts. Mode "data_subject_request"
 * also records in data_subject_requests that a file was GENERATED (metadata only,
 * same transaction). Delivery is a separate step recorded by staff.
 *
 * The Art. 15 information block is a DRAFT: purposes, retention, recipients etc.
 * are placeholders until the legal wording is provided (Needs legal review).
 */

export const DSR_TYPES = ["access", "portability", "rectification", "erasure", "restriction", "objection"] as const;
export const DSR_STATUSES = ["open", "in_progress", "export_generated", "delivered", "closed"] as const;
export const DSR_CHANNELS = ["email", "post", "in_person", "portal", "other"] as const;
export const DSR_CLOSE_REASONS = ["fulfilled", "rejected", "withdrawn", "identity_not_confirmed", "other"] as const;
export const DSR_REOPEN_REASONS = ["closed_by_mistake", "new_information", "requester_contact", "other"] as const;
export type DsrReopenReason = (typeof DSR_REOPEN_REASONS)[number];
export type DsrStatus = (typeof DSR_STATUSES)[number];
export type DsrChannel = (typeof DSR_CHANNELS)[number];
export type DsrCloseReason = (typeof DSR_CLOSE_REASONS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const requestFields = z
  .object({ type: z.enum(DSR_TYPES), receivedOn: isoDate, dueOn: isoDate, identityVerified: z.boolean() })
  .refine((r) => r.dueOn >= r.receivedOn);

export const exportRequestSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("admin"), includeInternalNotes: z.boolean().default(false) }),
  z.object({
    mode: z.literal("data_subject_request"),
    includeInternalNotes: z.boolean().default(false),
    /** An existing request; otherwise `request` describes a new one (identity must be confirmed). */
    requestId: z.string().uuid().optional(),
    request: requestFields.optional(),
  }).refine((r) => r.requestId || r.request?.identityVerified === true),
]);
export type ExportRequest = z.input<typeof exportRequestSchema>;

/** Placeholder text — the lawyer provides the final wording. */
const LEGAL_PENDING = "Needs legal review";

type ExportPayload = {
  meta: { counts: Record<string, number> };
  request?: { id: string; status: DsrStatus; exportCount: number } | null;
} & Record<string, unknown>;

export async function exportClientData(session: Session, clientId: string, input: ExportRequest): Promise<Record<string, unknown>> {
  assertCan(session.role, "clients.export");
  const id = z.string().uuid().parse(clientId);
  const req = exportRequestSchema.parse(input);
  if (req.includeInternalNotes) assertCan(session.role, "clients.export_internal_notes");

  const supabase = await createSupabaseServerClient();
  // One transaction in the database: the data, the request register and the audit entry.
  const { data, error } = await supabase.rpc("export_client_data", {
    p_workspace_id: session.workspaceId,
    p_client_id: id,
    p_include_internal_notes: req.includeInternalNotes,
    p_mode: req.mode,
    p_request: req.mode === "admin" ? null : { requestId: req.requestId, ...req.request },
  });
  if (error) throw toRepositoryError(error, "clients.export");
  const payload = data as ExportPayload;
  if (req.mode === "admin") return payload;

  const categories = Object.entries(payload.meta.counts)
    .filter(([, n]) => n > 0)
    .map(([k]) => k);
  return {
    ...payload,
    dataSubjectRequest: {
      status: "draft",
      notice: "Draft answer — legal wording pending. Not yet confirmed as a complete Art. 15 GDPR answer.",
      requestId: payload.request?.id,
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
  exportCount: number;
  lastExportedAt: string | null;
  deliveredAt: string | null;
  deliveryChannel: DsrChannel | null;
  closureReason: DsrCloseReason | null;
  closedAt: string | null;
  reopenCount: number;
}

const COLUMNS =
  "id,request_type,received_on,due_on,status,identity_verified,exported_categories,export_count,last_exported_at,delivered_at,delivery_channel,closure_reason,closed_at,reopen_count";

function fromRow(r: Record<string, unknown>): DataSubjectRequestRow {
  return {
    id: r.id as string,
    requestType: r.request_type as DataSubjectRequestRow["requestType"],
    receivedOn: r.received_on as string,
    dueOn: r.due_on as string,
    status: r.status as DsrStatus,
    identityVerified: r.identity_verified as boolean,
    exportedCategories: (r.exported_categories as string[] | null) ?? [],
    exportCount: r.export_count as number,
    lastExportedAt: (r.last_exported_at as string | null) ?? null,
    deliveredAt: (r.delivered_at as string | null) ?? null,
    deliveryChannel: (r.delivery_channel as DsrChannel | null) ?? null,
    closureReason: (r.closure_reason as DsrCloseReason | null) ?? null,
    closedAt: (r.closed_at as string | null) ?? null,
    reopenCount: (r.reopen_count as number | null) ?? 0,
  };
}

export async function listDataSubjectRequests(session: Session, clientId: string): Promise<DataSubjectRequestRow[]> {
  assertCan(session.role, "clients.export");
  const id = z.string().uuid().parse(clientId);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("data_subject_requests")
    .select(COLUMNS)
    .eq("workspace_id", session.workspaceId)
    .eq("client_id", id)
    .order("received_on", { ascending: false })
    .limit(50);
  if (error) throw toRepositoryError(error, "dataSubjectRequests.list");
  return ((data ?? []) as Record<string, unknown>[]).map(fromRow);
}

/** Registers a request without producing anything (status open). */
export async function registerDataSubjectRequest(
  session: Session,
  clientId: string,
  input: z.input<typeof requestFields>,
): Promise<DataSubjectRequestRow> {
  assertCan(session.role, "clients.export");
  const id = z.string().uuid().parse(clientId);
  const r = requestFields.parse(input);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("data_subject_requests")
    .insert({
      workspace_id: session.workspaceId,
      client_id: id,
      request_type: r.type,
      received_on: r.receivedOn,
      due_on: r.dueOn,
      identity_verified: r.identityVerified,
      responsible_profile_id: session.userId,
      created_by: session.userId,
    })
    .select(COLUMNS)
    .single();
  if (error) throw toRepositoryError(error, "dataSubjectRequests.create");
  return fromRow(data as Record<string, unknown>);
}

export const requestActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("start") }),
  z.object({ kind: z.literal("verify_identity") }),
  /** Records a handover by staff. It is not a proof that the person received the file. */
  z.object({ kind: z.literal("record_delivery"), channel: z.enum(DSR_CHANNELS) }),
  z.object({ kind: z.literal("close"), reason: z.enum(DSR_CLOSE_REASONS) }),
  /** Owner / admin; the reason comes from a fixed list and the step is audited. */
  z.object({ kind: z.literal("reopen"), reason: z.enum(DSR_REOPEN_REASONS) }),
]);
export type RequestAction = z.input<typeof requestActionSchema>;

/** The database enforces which step may follow which. */
export async function applyDataSubjectRequestAction(session: Session, requestId: string, input: RequestAction): Promise<DataSubjectRequestRow> {
  assertCan(session.role, "clients.export");
  const id = z.string().uuid().parse(requestId);
  const action = requestActionSchema.parse(input);
  if (action.kind === "reopen") {
    assertCan(session.role, "clients.reopen_request");
    const supabase = await createSupabaseServerClient();
    // One database transaction: reopening and its audit entry.
    const { error } = await supabase.rpc("reopen_data_subject_request", {
      p_workspace_id: session.workspaceId,
      p_request_id: id,
      p_reason: action.reason,
    });
    if (error) throw toRepositoryError(error, "dataSubjectRequests.reopen");
    const { data: reopened, error: readError } = await supabase.from("data_subject_requests").select(COLUMNS).eq("workspace_id", session.workspaceId).eq("id", id);
    if (readError) throw toRepositoryError(readError, "dataSubjectRequests.reopen");
    const reopenedRow = (reopened as Record<string, unknown>[] | null)?.[0];
    if (!reopenedRow) throw new RepositoryNotFoundError("dataSubjectRequests.reopen");
    return fromRow(reopenedRow);
  }
  const patch =
    action.kind === "start"
      ? { status: "in_progress" }
      : action.kind === "verify_identity"
        ? { identity_verified: true }
        : action.kind === "record_delivery"
          ? { status: "delivered", delivered_at: new Date().toISOString(), delivery_channel: action.channel }
          : { status: "closed", closure_reason: action.reason };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("data_subject_requests")
    .update(patch)
    .eq("workspace_id", session.workspaceId)
    .eq("id", id)
    .select(COLUMNS);
  if (error) throw toRepositoryError(error, "dataSubjectRequests.update");
  const row = (data as Record<string, unknown>[] | null)?.[0];
  if (!row) throw new RepositoryNotFoundError("dataSubjectRequests.update");
  return fromRow(row);
}
