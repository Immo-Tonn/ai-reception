import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan, can, PermissionDeniedError } from "@/server/permissions/roles";
import {
  getServerAppointmentsRepository,
  getServerAuditLogRepository,
  getServerServicesRepository,
  getServerStaffRepository,
  getServerWorkingHours,
} from "@/server/repository/registry";
import { RepositoryConflictError } from "@/server/repository/errors";
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  moveAppointmentSchema,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type MoveAppointmentInput,
} from "@/server/validation/appointment.schema";
import { checkSlotAvailable } from "@/features/appointments/availability";
import { activeStatuses } from "@/features/appointments/statusMeta";
import { checkInitialStatus, checkStatusTransition, HISTORY_STATUSES, wallNow, type DeleteBlocker, type WallNow } from "@/features/appointments/statusRules";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceTimeZone } from "./finance.service";
import { BusinessRuleError } from "./businessRuleError";
import { applyVisibility, applyVisibilityToList, type VisibleAppointment } from "./masking";
import type { Appointment } from "@/features/appointments/types";

export { BusinessRuleError };

async function auditLog(
  session: Session,
  entry: Omit<import("@/features/auditLog/types").AuditLogEntry, "id" | "timestamp">,
) {
  const repo = getServerAuditLogRepository(session.workspaceId);
  await repo.create({
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  });
}

/** `appointments.view` scoped list, with §6 masking already applied. */
export async function listAppointments(session: Session): Promise<VisibleAppointment[]> {
  assertCan(session.role, "appointments.view");
  const repo = getServerAppointmentsRepository(session.workspaceId);
  const all = await repo.list();
  return applyVisibilityToList(all, session);
}

export async function getAppointment(
  session: Session,
  id: string,
): Promise<VisibleAppointment | undefined> {
  assertCan(session.role, "appointments.view");
  const repo = getServerAppointmentsRepository(session.workspaceId);
  const appt = await repo.get(id);
  return appt ? applyVisibility(appt, session) : undefined;
}

async function checkBusinessRules(
  session: Session,
  candidate: Pick<
    Appointment,
    "id" | "staff" | "resourceId" | "date" | "time" | "durationMinutes" | "service"
  > &
    Partial<Pick<Appointment, "staffId" | "serviceId">>,
  options: { rejectInactiveService?: boolean } = {},
) {
  const [existing, services, staffList, workingHours] = await Promise.all([
    getServerAppointmentsRepository(session.workspaceId).list(),
    getServerServicesRepository(session.workspaceId).list(),
    getServerStaffRepository(session.workspaceId).list(),
    getServerWorkingHours(session.workspaceId),
  ]);

  const service =
    services.find((s) => (candidate.serviceId ? s.id === candidate.serviceId : s.name === candidate.service)) ??
    ({ id: candidate.serviceId ?? "", name: candidate.service, durationMinutes: candidate.durationMinutes } as const);
  // A new booking (or a changed service) must not use an archived service.
  if (options.rejectInactiveService && "active" in service && service.active === false) {
    throw new BusinessRuleError("This service is no longer offered.", "service_inactive");
  }
  const staff =
    staffList.find((s) => (candidate.staffId ? s.id === candidate.staffId : s.name === candidate.staff)) ??
    ({ id: candidate.staffId ?? candidate.staff, name: candidate.staff } as const);

  // The SAME rule Public Booking uses (`checkSlotAvailable`): working hours,
  // staff and resource collisions with buffers. The database's exclusion
  // constraints back it up if two requests race.
  const result = checkSlotAvailable({
    service: { ...service, durationMinutes: candidate.durationMinutes },
    staff,
    resourceId: candidate.resourceId,
    date: candidate.date,
    time: candidate.time,
    existingAppointments: existing,
    allServices: services,
    workingHours,
    ignoreAppointmentId: candidate.id,
  });
  if (result.available) return;

  if (result.reason === "staffConflict") {
    throw new BusinessRuleError(`${candidate.staff} already has an appointment at this time.`, "staff_conflict");
  }
  if (result.reason === "resourceConflict") {
    throw new BusinessRuleError("The selected resource is already booked at this time.", "resource_conflict");
  }
  throw new BusinessRuleError(
    `${candidate.staff} is not available at ${candidate.date} ${candidate.time} (${result.reason}).`,
    "outside_working_hours",
  );
}

/** "Now" on the workspace wall clock (demo workspaces: this machine's clock). */
async function workspaceNow(session: Session): Promise<WallNow> {
  return wallNow(await getWorkspaceTimeZone(session));
}

/** Server-side status rules (the UI shows only allowed actions, this is the authority). */
async function assertStatusChange(session: Session, before: Appointment, to: Appointment["status"]) {
  const verdict = checkStatusTransition(before, to, await workspaceNow(session));
  if (verdict.ok) return;
  throw new BusinessRuleError(`Status change ${before.status} -> ${to} is not allowed (${verdict.reason}).`, "invalid_status_transition");
}

/** A database-level collision (two requests raced past the check above) is the same business rule. */
async function writeOrConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RepositoryConflictError) {
      throw new BusinessRuleError("This time was just taken.", "staff_conflict");
    }
    throw error;
  }
}

export async function createAppointment(
  session: Session,
  input: CreateAppointmentInput,
): Promise<Appointment> {
  assertCan(session.role, "appointments.create");
  const data = createAppointmentSchema.parse(input);
  if (!checkInitialStatus(data, data.status, await workspaceNow(session))) {
    throw new BusinessRuleError(`Status ${data.status} is not allowed for this appointment time.`, "invalid_status_transition");
  }

  await checkBusinessRules(session, {
    id: "new",
    staff: data.staff,
    staffId: data.staffId,
    serviceId: data.serviceId,
    resourceId: data.resourceId,
    date: data.date,
    time: data.time,
    durationMinutes: data.durationMinutes,
    service: data.service,
  }, { rejectInactiveService: true });

  const draft: Appointment = {
    ...data,
    id: crypto.randomUUID(),
    seriesId: data.seriesId ?? null,
    recurrence: data.recurrence ?? null,
  };

  const repo = getServerAppointmentsRepository(session.workspaceId);
  // Real repositories assign the stable id themselves; use what they return.
  const appointment = await writeOrConflict(() => repo.create(draft));

  await auditLog(session, {
    action: "created",
    entityType: "appointment",
    entityId: appointment.id,
    summary: `${appointment.service} · ${appointment.date} ${appointment.time}`,
    source: "user",
  });

  return appointment;
}

export async function updateAppointment(
  session: Session,
  id: string,
  input: UpdateAppointmentInput,
): Promise<Appointment | undefined> {
  assertCan(session.role, "appointments.edit");
  const patch = updateAppointmentSchema.parse(input);

  const repo = getServerAppointmentsRepository(session.workspaceId);
  const before = await repo.get(id);
  if (!before) return undefined;

  const merged = { ...before, ...patch };
  const statusChanged = patch.status !== undefined && patch.status !== before.status;
  if (statusChanged) await assertStatusChange(session, before, patch.status!);
  // The occupied slot changes when the time / person / length / service changes, or a
  // non-active appointment becomes active again. A pure outcome change (completed,
  // no-show, cancelled) or a notes/paid edit frees or keeps the slot and needs no check.
  const slotChanged =
    merged.date !== before.date ||
    merged.time !== before.time ||
    merged.durationMinutes !== before.durationMinutes ||
    (merged.staffId ?? merged.staff) !== (before.staffId ?? before.staff) ||
    (merged.serviceId ?? merged.service) !== (before.serviceId ?? before.service) ||
    merged.resourceId !== before.resourceId ||
    (activeStatuses.has(merged.status) && !activeStatuses.has(before.status));
  if (slotChanged && activeStatuses.has(merged.status)) await checkBusinessRules(session, {
    id,
    staff: merged.staff,
    staffId: merged.staffId,
    serviceId: merged.serviceId,
    resourceId: merged.resourceId,
    date: merged.date,
    time: merged.time,
    durationMinutes: merged.durationMinutes,
    service: merged.service,
  }, {
    // Editing an old appointment keeps its (possibly archived) service; only picking another one is checked.
    rejectInactiveService: merged.serviceId !== before.serviceId || merged.service !== before.service,
  });

  const updated = await writeOrConflict(() => repo.update(id, patch));

  await auditLog(session, {
    action: statusChanged ? "statusChanged" : "updated",
    entityType: "appointment",
    entityId: id,
    summary: statusChanged
      ? // A change away from an outcome (completed / no-show / cancelled) is a correction of a wrong mark.
        `Status: ${before.status} → ${patch.status}${HISTORY_STATUSES.has(before.status) || before.status === "cancelled" ? " (correction)" : ""}`
      : "Appointment updated",
    source: "user",
  });

  return updated;
}

export async function moveAppointment(
  session: Session,
  input: MoveAppointmentInput,
): Promise<Appointment | undefined> {
  assertCan(session.role, "appointments.edit");
  const { id, date, time } = moveAppointmentSchema.parse(input);

  const repo = getServerAppointmentsRepository(session.workspaceId);
  const before = await repo.get(id);
  if (!before) return undefined;
  // Only an upcoming active appointment can be moved; a past outcome stays where it happened.
  if (!activeStatuses.has(before.status) || HISTORY_STATUSES.has(before.status)) {
    throw new BusinessRuleError("Only upcoming active appointments can be moved.", "invalid_status_transition");
  }

  await checkBusinessRules(session, { ...before, id, date, time });

  const updated = await writeOrConflict(() => repo.update(id, { date, time }));

  await auditLog(session, {
    action: "moved",
    entityType: "appointment",
    entityId: id,
    summary: `${before.time} → ${time} (${date})`,
    source: "user",
  });

  return updated;
}

export async function cancelAppointment(
  session: Session,
  id: string,
): Promise<Appointment | undefined> {
  assertCan(session.role, "appointments.cancel");
  const repo = getServerAppointmentsRepository(session.workspaceId);
  const before = await repo.get(id);
  if (!before) return undefined;
  if (before.status === "cancelled") return before;
  await assertStatusChange(session, before, "cancelled");

  const updated = await repo.update(id, { status: "cancelled" });

  await auditLog(session, {
    action: "cancelled",
    entityType: "appointment",
    entityId: id,
    summary: `${before.service} · ${before.date} ${before.time}`,
    source: "user",
  });

  return updated;
}

export type { DeleteBlocker };

/**
 * Why an appointment must NOT be physically deleted (empty = it may be deleted).
 * Physical deletion is only for appointments created by mistake inside the
 * business app; everything that happened or that a client knows about stays as
 * a record with its status (cancel / no-show instead). Migration 0027 adds the
 * same guard in the database (`guard_appointment_delete`), which also sees
 * private invoices and client-account links that RLS hides from this check.
 */
export async function getDeleteBlockers(session: Session, appt: Appointment): Promise<DeleteBlocker[]> {
  const blockers: DeleteBlocker[] = [];
  if (!can(session.role, "settings.manage")) blockers.push("not_permitted"); // owner / admin only
  if (HISTORY_STATUSES.has(appt.status)) blockers.push("has_history");
  if (isDemoWorkspaceSlug(session.workspaceId)) return blockers;
  const client = await createSupabaseServerClient();
  const [row, invoice, waiting] = await Promise.all([
    client.from("appointments").select("source").eq("id", appt.id).eq("workspace_id", session.workspaceId).maybeSingle(),
    client.from("invoices").select("id").eq("workspace_id", session.workspaceId).eq("appointment_id", appt.id).limit(1),
    client.from("waiting_list").select("id").eq("workspace_id", session.workspaceId).eq("booked_appointment_id", appt.id).limit(1),
  ]);
  if (row.error || invoice.error || waiting.error) throw new BusinessRuleError("Could not check what depends on this appointment.", "delete_not_allowed");
  if ((row.data as { source?: string } | null)?.source !== "user") blockers.push("online_booking");
  if ((invoice.data as unknown[] | null)?.length) blockers.push("invoice");
  if ((waiting.data as unknown[] | null)?.length) blockers.push("waiting_list");
  return blockers;
}

export async function getAppointmentDeleteBlockers(session: Session, id: string): Promise<DeleteBlocker[]> {
  assertCan(session.role, "appointments.view");
  const appt = await getServerAppointmentsRepository(session.workspaceId).get(id);
  if (!appt) return ["not_permitted"];
  return getDeleteBlockers(session, appt);
}

export async function removeAppointment(session: Session, id: string): Promise<void> {
  assertCan(session.role, "appointments.cancel");
  const repo = getServerAppointmentsRepository(session.workspaceId);
  const before = await repo.get(id);
  if (!before) return;
  const blockers = await getDeleteBlockers(session, before);
  if (blockers.includes("not_permitted")) throw new PermissionDeniedError(session.role, "settings.manage");
  if (blockers.length > 0) {
    throw new BusinessRuleError(`This appointment cannot be deleted (${blockers.join(", ")}); cancel it instead.`, "delete_not_allowed");
  }
  await repo.remove(id);
  await auditLog(session, {
    action: "deleted",
    entityType: "appointment",
    entityId: id,
    summary: `${before.service} · ${before.date} ${before.time}`,
    source: "user",
  });
}
