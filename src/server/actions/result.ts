// Plain (non-"use server") module: shared result envelope for actions that
// the browser calls from a *repository* (calendar, clients, audit log).
// In production Next.js masks the message of any error thrown out of a
// Server Action, so expected failures (a conflict, a missing permission)
// travel as data instead of exceptions.

export type ActionErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "staff_conflict"
  | "resource_conflict"
  | "outside_working_hours"
  | "generic";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string };
