"use server";

import { getSession } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getServerAuditLogRepository } from "@/server/repository/registry";
import type { AuditLogEntry } from "@/features/auditLog/types";
import { runAction } from "./runAction";
import type { ActionResult } from "./result";

export async function listAuditLogAction(workspaceSlug: string): Promise<ActionResult<AuditLogEntry[]>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    assertCan(session.role, "audit_log.view");
    return getServerAuditLogRepository(session.workspaceId).list();
  });
}
