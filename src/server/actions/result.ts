import { ZodError } from "zod";
import { PermissionDeniedError } from "@/server/permissions/roles";
import { BusinessRuleError } from "@/server/services/businessRuleError";
import {
  RepositoryConflictError,
  RepositoryForbiddenError,
  RepositoryNotFoundError,
} from "@/server/repository/errors";
import { UnauthenticatedError, WorkspaceAccessError } from "@/server/auth/resolveSession";

/**
 * What a Server Action returns to the browser: data or a stable error CODE.
 * Raw error messages (database text, stack traces) never cross this line —
 * the UI localizes the code.
 */
export type ActionErrorCode = "unauthenticated" | "forbidden" | "invalid_input" | "not_found" | "conflict" | "unknown";
export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: ActionErrorCode };

export function toActionError(error: unknown): ActionErrorCode {
  if (error instanceof UnauthenticatedError) return "unauthenticated";
  if (
    error instanceof WorkspaceAccessError ||
    error instanceof PermissionDeniedError ||
    error instanceof RepositoryForbiddenError
  ) {
    return "forbidden";
  }
  if (error instanceof BusinessRuleError || error instanceof RepositoryConflictError) return "conflict";
  if (error instanceof RepositoryNotFoundError) return "not_found";
  if (error instanceof ZodError) return "invalid_input";
  return "unknown";
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    const code = toActionError(error);
    if (code === "unknown") {
      // Server log only; no payload, no PII.
      console.error("[action] unexpected failure:", error instanceof Error ? error.name : "unknown");
    }
    return { ok: false, code };
  }
}
