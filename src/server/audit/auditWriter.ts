import type { AuditLogEntry } from "@/features/auditLog/types";

/**
 * The ONLY application path that writes to `audit_logs` (migration 0033 closes the
 * table for direct inserts by the signed-in user). The write is done with the
 * service role, but only after the server itself has checked who is asking:
 *  1. the user is identified by the auth server (`auth.getUser()`, not a cookie claim);
 *  2. the user is a member of the workspace the entry is about;
 *  3. action and entity type come from fixed lists, `source` is always "user"
 *     and the actor is the verified user — the caller cannot choose either.
 * Entries written by the database itself (triggers and definer functions) do not
 * pass through here.
 *
 * KNOWN LIMITATION (documented, accepted): for ordinary services (appointments,
 * clients, finance, ...) the business change and its audit entry are TWO separate
 * requests, not one transaction. If the audit write fails after the change, the
 * change stays and the failure is logged (error name/code only, never personal
 * data). Operations that must be atomic with their audit entry (archive, retention
 * setting, anonymization, export, data subject requests) are audited inside the
 * database in the same transaction instead.
 */

export const AUDIT_ACTIONS = ["created", "updated", "moved", "statusChanged", "cancelled", "deleted"] as const satisfies readonly AuditLogEntry["action"][];
export const AUDIT_ENTITY_TYPES = [
  "appointment", "invoice", "client", "workspace", "waitingListEntry", "lead", "quote", "job", "project",
  "staff", "resource", "workingHours", "timeOff", "bookingRules", "dataSubjectRequest",
] as const satisfies readonly AuditLogEntry["entityType"][];

const MAX_SUMMARY = 500;
const MAX_ENTITY_ID = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditWriteInput {
  workspaceId: string;
  action: AuditLogEntry["action"];
  entityType: AuditLogEntry["entityType"];
  entityId: string;
  summary: string;
}

export interface AuditWriterDeps {
  /** Verified user id from the auth server, or null when nobody is signed in. */
  getUserId(): Promise<string | null>;
  isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean>;
  insert(row: {
    workspace_id: string;
    actor_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    summary: string;
    source: "user";
  }): Promise<{ code?: string } | null>;
}

/** Carries a code only — never the message of the underlying error. */
export class AuditWriteError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(`audit write failed: ${code}`);
    this.name = "AuditWriteError";
    this.code = code;
  }
}

export async function writeAuditEntry(input: AuditWriteInput, deps: AuditWriterDeps): Promise<void> {
  const fail = (code: string): never => {
    console.error("[audit] write failed:", code);
    throw new AuditWriteError(code);
  };
  if (!UUID.test(input.workspaceId)) return fail("invalid_workspace");
  if (!(AUDIT_ACTIONS as readonly string[]).includes(input.action)) return fail("invalid_action");
  if (!(AUDIT_ENTITY_TYPES as readonly string[]).includes(input.entityType)) return fail("invalid_entity_type");
  if (typeof input.entityId !== "string" || input.entityId.length === 0 || input.entityId.length > MAX_ENTITY_ID) return fail("invalid_entity_id");

  let userId: string | null;
  try {
    userId = await deps.getUserId();
  } catch {
    return fail("auth_unavailable");
  }
  if (!userId) return fail("not_authenticated");

  let member: boolean;
  try {
    member = await deps.isWorkspaceMember(input.workspaceId, userId);
  } catch {
    return fail("membership_check_failed");
  }
  if (!member) return fail("not_a_member");

  let result: { code?: string } | null;
  try {
    result = await deps.insert({
      workspace_id: input.workspaceId,
      actor_id: userId,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId,
      summary: String(input.summary ?? "").slice(0, MAX_SUMMARY),
      source: "user",
    });
  } catch {
    return fail("insert_failed");
  }
  if (result) return fail(result.code ?? "insert_failed");
}
