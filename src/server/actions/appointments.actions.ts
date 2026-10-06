"use server";

import { getSession } from "@/server/auth/session";
import * as appointmentsService from "@/server/services/appointments.service";
import type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
  MoveAppointmentInput,
} from "@/server/validation/appointment.schema";
import type { Appointment } from "@/features/appointments/types";
import type { VisibleAppointment } from "@/server/services/masking";
import { runAction } from "./runAction";
import type { ActionResult } from "./result";

/**
 * Server Actions = the typed contract layer (§6). Each one is:
 * resolve session → call the application service, which itself runs
 * validate → authorize → business rules → repository → audit. Nothing
 * here duplicates that pipeline — these are thin, intentionally boring.
 * Expected failures come back as `{ ok: false, code }` (see ./result).
 */

export async function listAppointmentsAction(
  workspaceSlug: string,
): Promise<ActionResult<VisibleAppointment[]>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    return appointmentsService.listAppointments(session);
  });
}

export async function createAppointmentAction(
  workspaceSlug: string,
  input: CreateAppointmentInput,
): Promise<ActionResult<Appointment>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    return appointmentsService.createAppointment(session, input);
  });
}

export async function updateAppointmentAction(
  workspaceSlug: string,
  id: string,
  input: UpdateAppointmentInput,
): Promise<ActionResult<Appointment | undefined>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    return appointmentsService.updateAppointment(session, id, input);
  });
}

export async function moveAppointmentAction(
  workspaceSlug: string,
  input: MoveAppointmentInput,
): Promise<ActionResult<Appointment | undefined>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    return appointmentsService.moveAppointment(session, input);
  });
}

export async function cancelAppointmentAction(
  workspaceSlug: string,
  id: string,
): Promise<ActionResult<Appointment | undefined>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    return appointmentsService.cancelAppointment(session, id);
  });
}

export async function removeAppointmentAction(
  workspaceSlug: string,
  id: string,
): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await getSession(workspaceSlug);
    await appointmentsService.removeAppointment(session, id);
  });
}
