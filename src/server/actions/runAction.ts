import "server-only";
import { ZodError } from "zod";
import { PermissionDeniedError } from "@/server/permissions/roles";
import { UnauthenticatedError, WorkspaceAccessError } from "@/server/auth/session";
import { BusinessRuleError } from "@/server/services/appointments.service";
import { AppointmentConflictError } from "@/server/repository/supabase/appointmentsRepository";
import { BookingUnavailableError } from "@/server/services/publicBooking.service";
import type { ActionResult } from "./result";

/** Runs `fn` and converts expected failures into an `ActionResult`. */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof BusinessRuleError) {
      return { ok: false, code: error.code, message: error.message };
    }
    if (error instanceof AppointmentConflictError || error instanceof BookingUnavailableError) {
      return { ok: false, code: "staff_conflict", message: error.message };
    }
    if (error instanceof PermissionDeniedError) {
      return { ok: false, code: "forbidden", message: error.message };
    }
    if (error instanceof UnauthenticatedError || error instanceof WorkspaceAccessError) {
      return { ok: false, code: "unauthenticated", message: error.message };
    }
    if (error instanceof ZodError) {
      return { ok: false, code: "invalid", message: "Invalid input." };
    }
    console.error("[action] unexpected failure", error);
    return { ok: false, code: "generic", message: "Something went wrong." };
  }
}
