"use server";

import { getSession } from "@/server/auth/session";
import * as appointmentsService from "@/server/services/appointments.service";
import type {
  CreateAppointmentInput,
  UpdateAppointmentInput,
  MoveAppointmentInput,
} from "@/server/validation/appointment.schema";

/**
 * Server Actions = the typed contract layer (§6). Each one is:
 * resolve session → call the application service, which itself runs
 * validate → authorize → business rules → repository → audit. Nothing
 * here duplicates that pipeline — these are thin, intentionally boring.
 */

export async function listAppointmentsAction(workspaceId: string) {
  const session = await getSession(workspaceId);
  return appointmentsService.listAppointments(session);
}

export async function createAppointmentAction(
  workspaceId: string,
  input: CreateAppointmentInput,
) {
  const session = await getSession(workspaceId);
  return appointmentsService.createAppointment(session, input);
}

export async function updateAppointmentAction(
  workspaceId: string,
  id: string,
  input: UpdateAppointmentInput,
) {
  const session = await getSession(workspaceId);
  return appointmentsService.updateAppointment(session, id, input);
}

export async function moveAppointmentAction(workspaceId: string, input: MoveAppointmentInput) {
  const session = await getSession(workspaceId);
  return appointmentsService.moveAppointment(session, input);
}

export async function cancelAppointmentAction(workspaceId: string, id: string) {
  const session = await getSession(workspaceId);
  return appointmentsService.cancelAppointment(session, id);
}
