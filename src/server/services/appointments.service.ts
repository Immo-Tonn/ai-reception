import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import {
  getServerAppointmentsRepository,
  getServerAuditLogRepository,
  getServerServicesRepository,
} from "@/server/repository/registry";
import {
  createAppointmentSchema,
  updateAppointmentSchema,
  moveAppointmentSchema,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type MoveAppointmentInput,
} from "@/server/validation/appointment.schema";
import { findConflicts } from "@/features/appointments/conflicts";
import { getServerWorkingHours } from "@/server/repository/workingHours";
import { checkAvailability } from "@/features/workingHours/logic";
import { applyVisibility, applyVisibilityToList, type VisibleAppointment } from "./masking";
import type { Appointment } from "@/features/appointments/types";

export class BusinessRuleError extends Error {
  constructor(
    message: string,
    public code: "staff_conflict" | "resource_conflict" | "outside_working_hours",
  ) {
    super(message);
    this.name = "BusinessRuleError";
  }
}

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
  >,
) {
  const repo = getServerAppointmentsRepository(session.workspaceId);
  const servicesRepo = getServerServicesRepository(session.workspaceId);
  const [existing, services, workingHours] = await Promise.all([
    repo.list(),
    servicesRepo.list(),
    getServerWorkingHours(session.workspaceId),
  ]);

  const availability = checkAvailability(
    candidate.staff,
    candidate.date,
    candidate.time,
    candidate.durationMinutes,
    workingHours,
  );
  if (!availability.available) {
    throw new BusinessRuleError(
      `${candidate.staff} is not available at ${candidate.date} ${candidate.time} (${availability.reason}).`,
      "outside_working_hours",
    );
  }

  const conflict = findConflicts(candidate, existing, services);
  if (conflict.staffConflict) {
    throw new BusinessRuleError(
      `${candidate.staff} already has an appointment at this time.`,
      "staff_conflict",
    );
  }
  if (conflict.resourceConflict) {
    throw new BusinessRuleError("The selected resource is already booked at this time.", "resource_conflict");
  }
}

export async function createAppointment(
  session: Session,
  input: CreateAppointmentInput,
): Promise<Appointment> {
  assertCan(session.role, "appointments.create");
  const data = createAppointmentSchema.parse(input);

  await checkBusinessRules(session, {
    id: "new",
    staff: data.staff,
    resourceId: data.resourceId,
    date: data.date,
    time: data.time,
    durationMinutes: data.durationMinutes,
    service: data.service,
  });

  const draft: Appointment = {
    ...data,
    id: data.id ?? crypto.randomUUID(),
    seriesId: data.seriesId ?? null,
    recurrence: data.recurrence ?? null,
  };

  const repo = getServerAppointmentsRepository(session.workspaceId);
  const appointment = await repo.create(draft);

  await auditLog(session, {
    action: "created",
    entityType: "appointment",
    entityId: appointment.id,
    summary: `${appointment.client} · ${appointment.service} · ${appointment.date} ${appointment.time}`,
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

  // Only re-validate the schedule when something about *when/who/what*
  // actually changed — a status change, "mark paid" or a notes edit must
  // never fail just because working hours were edited after the booking
  // was made.
  const reschedules =
    patch.staff !== undefined ||
    patch.date !== undefined ||
    patch.time !== undefined ||
    patch.durationMinutes !== undefined ||
    patch.resourceId !== undefined ||
    patch.service !== undefined;
  if (reschedules) {
    const merged = { ...before, ...patch };
    await checkBusinessRules(session, {
      id,
      staff: merged.staff,
      resourceId: merged.resourceId,
      date: merged.date,
      time: merged.time,
      durationMinutes: merged.durationMinutes,
      service: merged.service,
    });
  }

  const updated = await repo.update(id, patch);

  await auditLog(session, {
    action: patch.status && patch.status !== before.status ? "statusChanged" : "updated",
    entityType: "appointment",
    entityId: id,
    summary:
      patch.status && patch.status !== before.status
        ? `Status: ${before.status} → ${patch.status}`
        : `${before.client} updated`,
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

  await checkBusinessRules(session, { ...before, id, date, time });

  const updated = await repo.update(id, { date, time });

  await auditLog(session, {
    action: "moved",
    entityType: "appointment",
    entityId: id,
    summary: `${before.client}: ${before.time} → ${time} (${date})`,
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

  const updated = await repo.update(id, { status: "cancelled" });

  await auditLog(session, {
    action: "cancelled",
    entityType: "appointment",
    entityId: id,
    summary: `${before.client} · ${before.service} · ${before.date} ${before.time}`,
    source: "user",
  });

  return updated;
}

/** Permanently deletes an appointment (cancelling keeps it, with status). */
export async function removeAppointment(session: Session, id: string): Promise<void> {
  assertCan(session.role, "appointments.cancel");
  const repo = getServerAppointmentsRepository(session.workspaceId);
  const before = await repo.get(id);
  if (!before) return;

  await repo.remove(id);

  await auditLog(session, {
    action: "deleted",
    entityType: "appointment",
    entityId: id,
    summary: `${before.client} · ${before.service}`,
    source: "user",
  });
}
