"use server";

import { getSession } from "@/server/auth/session";
import * as servicesService from "@/server/services/services.service";
import { runAction, type ActionResult } from "./result";
import type { CreateServiceInput, UpdateServiceInput } from "@/server/validation/service.schema";
import type { ServiceDefinition } from "@/features/services/types";

export async function listServicesAction(workspaceSlug: string): Promise<ActionResult<ServiceDefinition[]>> {
  return runAction(async () => servicesService.listServices(await getSession(workspaceSlug)));
}

export async function createServiceAction(
  workspaceSlug: string,
  input: CreateServiceInput,
): Promise<ActionResult<ServiceDefinition>> {
  return runAction(async () => servicesService.createService(await getSession(workspaceSlug), input));
}

export async function updateServiceAction(
  workspaceSlug: string,
  id: string,
  input: UpdateServiceInput,
): Promise<ActionResult<ServiceDefinition | undefined>> {
  return runAction(async () => servicesService.updateService(await getSession(workspaceSlug), id, input));
}

export async function removeServiceAction(workspaceSlug: string, id: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    await servicesService.removeService(await getSession(workspaceSlug), id);
    return null;
  });
}
