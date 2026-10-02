import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
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
  });

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
  await checkBusinessRules(session, {
    id,
    staff: merged.staff,
    staffId: merged.staffId,
    serviceId: merged.serviceId,
    resourceId: merged.resourceId,
    date: merged.date,
    time: merged.time,
    durationMinutes: merged.durationMinutes,
    service: merged.service,
  });

  const updated = await writeOrConflict(() => repo.update(id, patch));

  await auditLog(session, {
    action: patch.status && patch.status !== before.status ? "statusChanged" : "updated",
    entityType: "appointment",
    entityId: id,
    summary:
      patch.status && patch.status !== before.status
        ? `Status: ${before.status} → ${patch.status}`
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
    summary: `${before.service} · ${before.date} ${before.time}`,
    source: "user",
  });
}
