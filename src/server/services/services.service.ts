import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getServerServicesRepository } from "@/server/repository/registry";
import {
  createServiceSchema,
  updateServiceSchema,
  type CreateServiceInput,
  type UpdateServiceInput,
} from "@/server/validation/service.schema";
import type { ServiceDefinition } from "@/features/services/types";

export async function listServices(session: Session): Promise<ServiceDefinition[]> {
  return getServerServicesRepository(session.workspaceId).list();
}

export async function createService(
  session: Session,
  input: CreateServiceInput,
): Promise<ServiceDefinition> {
  assertCan(session.role, "settings.manage");
  const data = createServiceSchema.parse(input);
  const service: ServiceDefinition = {
    id: crypto.randomUUID(),
    name: data.name,
    durationMinutes: data.durationMinutes,
    price: data.price,
    currency: data.currency,
    bufferBeforeMinutes: data.bufferBeforeMinutes,
    bufferAfterMinutes: data.bufferAfterMinutes,
    allowedStaffIds: data.allowedStaffIds,
    requiredResourceType: null,
  };
  return getServerServicesRepository(session.workspaceId).create(service);
}

export async function updateService(
  session: Session,
  id: string,
  input: UpdateServiceInput,
): Promise<ServiceDefinition | undefined> {
  assertCan(session.role, "settings.manage");
  const patch = updateServiceSchema.parse(input);
  return getServerServicesRepository(session.workspaceId).update(id, patch);
}

export async function removeService(session: Session, id: string): Promise<void> {
  assertCan(session.role, "settings.manage");
  await getServerServicesRepository(session.workspaceId).remove(id);
}
