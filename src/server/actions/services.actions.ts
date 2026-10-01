"use server";

import { getSession } from "@/server/auth/session";
import * as servicesService from "@/server/services/services.service";
import type { CreateServiceInput, UpdateServiceInput } from "@/server/validation/service.schema";

export async function listServicesAction(workspaceSlug: string) {
  const session = await getSession(workspaceSlug);
  return servicesService.listServices(session);
}

export async function createServiceAction(workspaceSlug: string, input: CreateServiceInput) {
  const session = await getSession(workspaceSlug);
  return servicesService.createService(session, input);
}

export async function updateServiceAction(
  workspaceSlug: string,
  id: string,
  input: UpdateServiceInput,
) {
  const session = await getSession(workspaceSlug);
  return servicesService.updateService(session, id, input);
}

export async function removeServiceAction(workspaceSlug: string, id: string) {
  const session = await getSession(workspaceSlug);
  await servicesService.removeService(session, id);
}
