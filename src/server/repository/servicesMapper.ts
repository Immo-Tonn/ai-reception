import type { ServiceDefinition } from "@/features/services/types";

/** Row shape of `public.services` (+ the embedded `service_staff` join). */
export interface ServiceRow {
  id: string;
  workspace_id?: string;
  name: string;
  duration_minutes: number;
  price: number | string;
  currency: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  required_resource_type: string | null;
  service_staff?: { staff_id: string }[] | null;
}

export function serviceFromRow(row: ServiceRow): ServiceDefinition {
  return {
    id: row.id,
    name: row.name,
    durationMinutes: row.duration_minutes,
    price: Number(row.price), // numeric comes back as string from PostgREST
    currency: row.currency,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    allowedStaffIds: (row.service_staff ?? []).map((link) => link.staff_id),
    requiredResourceType: row.required_resource_type,
  };
}

/** Insert/update payload. `workspace_id` is added by the repository, never taken from callers. */
export function serviceToRow(service: Partial<ServiceDefinition>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (service.name !== undefined) row.name = service.name;
  if (service.durationMinutes !== undefined) row.duration_minutes = service.durationMinutes;
  if (service.price !== undefined) row.price = service.price;
  if (service.currency !== undefined) row.currency = service.currency;
  if (service.bufferBeforeMinutes !== undefined) row.buffer_before_minutes = service.bufferBeforeMinutes;
  if (service.bufferAfterMinutes !== undefined) row.buffer_after_minutes = service.bufferAfterMinutes;
  if (service.requiredResourceType !== undefined) row.required_resource_type = service.requiredResourceType;
  return row;
}
