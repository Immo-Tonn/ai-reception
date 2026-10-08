"use server";

import { getSession } from "@/server/auth/session";
import * as appointmentsService from "@/server/services/appointments.service";
import type { VisibleAppointment } from "@/server/services/masking";
import { runAction, type ActionResult } from "./result";
import type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
  MoveAppointmentInput,
} from "@/server/validation/appointment.schema";
import type { Appointment } from "@/features/appointments/types";

/**
 * Server Actions = the typed contract layer. Each one resolves the session,
 * then calls the application service, which validates -> authorizes ->
 * applies business rules -> writes through the repository (-> audit). The
 * workspace always comes from the SESSION (route slug verified against the
 * user's membership), never from the request body. Results are
 * `ActionResult`: data or a stable code, no raw errors.
 */

export async function listAppointmentsAction(workspaceSlug: string): Promise<ActionResult<VisibleAppointment[]>> {
  return runAction(async () => appointmentsService.listAppointments(await getSession(workspaceSlug)));
}

export async function getAppointmentAction(workspaceSlug: string, id: string): Promise<ActionResult<VisibleAppointment | undefined>> {
  return runAction(async () => appointmentsService.getAppointment(await getSession(workspaceSlug), id));
}

export async function createAppointmentAction(
  workspaceSlug: string,
  input: CreateAppointmentInput,
): Promise<ActionResult<Appointment>> {
  return runAction(async () => appointmentsService.createAppointment(await getSession(workspaceSlug), input));
}

export async function updateAppointmentAction(
  workspaceSlug: string,
  id: string,
  input: UpdateAppointmentInput,
): Promise<ActionResult<Appointment | undefined>> {
  return runAction(async () => appointmentsService.updateAppointment(await getSession(workspaceSlug), id, input));
}

export async function moveAppointmentAction(
  workspaceSlug: string,
  input: MoveAppointmentInput,
): Promise<ActionResult<Appointment | undefined>> {
  return runAction(async () => appointmentsService.moveAppointment(await getSession(workspaceSlug), input));
}

export async function cancelAppointmentAction(
  workspaceSlug: string,
  id: string,
): Promise<ActionResult<Appointment | undefined>> {
  return runAction(async () => appointmentsService.cancelAppointment(await getSession(workspaceSlug), id));
}

export async function removeAppointmentAction(workspaceSlug: string, id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await appointmentsService.removeAppointment(await getSession(workspaceSlug), id);
    return null;
  });
}
