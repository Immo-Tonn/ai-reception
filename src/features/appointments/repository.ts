import { createLocalRepository } from "@/lib/repository/createLocalRepository";
import { createRemoteRepository } from "@/lib/repository/createRemoteRepository";
import type { Repository } from "@/lib/repository/types";
import type { Appointment } from "./types";
import type { VisibleAppointment } from "@/server/services/masking";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import {
  createAppointmentAction,
  listAppointmentsAction,
  removeAppointmentAction,
  updateAppointmentAction,
} from "@/server/actions/appointments.actions";

const cache = new Map<string, Repository<Appointment>>();

/** A private/masked record the viewer may not read — shown as "Busy". */
function fromVisible(item: VisibleAppointment): Appointment {
  if (!("masked" in item) || !item.masked) return item as Appointment;
  return {
    id: item.id,
    client: "",
    service: "",
    staff: item.staff,
    resourceId: null,
    date: item.date,
    time: item.time,
    durationMinutes: item.durationMinutes,
    price: 0,
    currency: "EUR",
    notes: "",
    visibility: item.visibility,
    financialBucket: "main",
    status: item.status,
    paid: false,
    seriesId: null,
    recurrence: null,
  };
}

function createRemoteAppointmentsRepository(workspaceSlug: string): Repository<Appointment> {
  return createRemoteRepository<Appointment>({
    async list() {
      const result = await listAppointmentsAction(workspaceSlug);
      return result.ok ? { ok: true, data: result.data.map(fromVisible) } : result;
    },
    create: (item) => createAppointmentAction(workspaceSlug, item),
    update: (id, patch) => updateAppointmentAction(workspaceSlug, id, patch),
    remove: (id) => removeAppointmentAction(workspaceSlug, id),
  });
}

export function getAppointmentsRepository(workspaceSlug: string): Repository<Appointment> {
  const key = `serviceos:${workspaceSlug}:appointments`;
  let repository = cache.get(key);
  if (!repository) {
    repository = isDemoWorkspaceSlug(workspaceSlug)
      ? createLocalRepository<Appointment>(key, getWorkspaceConfig(workspaceSlug).appointments)
      : createRemoteAppointmentsRepository(workspaceSlug);
    cache.set(key, repository);
  }
  return repository;
}
