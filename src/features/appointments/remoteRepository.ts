import { createRemoteRepository } from "@/lib/repository/createRemoteRepository";
import type { Repository } from "@/lib/repository/types";
import {
  createAppointmentAction,
  listAppointmentsAction,
  getAppointmentAction,
  removeAppointmentAction,
  updateAppointmentAction,
} from "@/server/actions/appointments.actions";
import type { VisibleAppointment } from "@/server/services/masking";
import type { Appointment } from "./types";

/** A masked ("busy") entry as a full `Appointment` with neutral placeholders; only time/person/visibility are real. */
function fromVisible(item: VisibleAppointment): Appointment {
  if (!item.masked) {
    const { masked: _masked, ...rest } = item;
    void _masked;
    return rest;
  }
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

/** Only fields the server accepts; ids/series are decided there. */
function writableFields(item: Partial<Appointment>) {
  const {
    client, service, staff, clientId, serviceId, staffId, financialBucketId, resourceId, date, time,
    durationMinutes, price, currency, notes, visibility, financialBucket, status, paid,
  } = item;
  return Object.fromEntries(
    Object.entries({
      client, service, staff, clientId, serviceId, staffId, financialBucketId, resourceId, date, time,
      durationMinutes, price, currency, notes, visibility, financialBucket, status, paid,
    }).filter(([, v]) => v !== undefined),
  );
}

/**
 * Appointments of a REAL workspace: every operation is a Server Action, which
 * authorizes against the signed-in user and reads/writes the shared database.
 * Nothing is kept in this browser, so another device sees the same data and a
 * reload loses nothing.
 *
 * Recurring series: the screen generates a temporary series id for the first
 * occurrence; the server creates the real series and returns its id, which is
 * remembered here so the remaining occurrences join the same series.
 */
export function createRemoteAppointmentsRepository(workspaceSlug: string): Repository<Appointment> {
  const seriesIds = new Map<string, string>();

  return createRemoteRepository<Appointment>({
    list: async () => {
      const r = await listAppointmentsAction(workspaceSlug);
      return r.ok ? { ok: true, data: r.data.map(fromVisible) } : r;
    },
    get: async (id) => {
      const r = await getAppointmentAction(workspaceSlug, id);
      return r.ok ? { ok: true, data: r.data ? fromVisible(r.data) : undefined } : r;
    },
    create: async (item) => {
      const tempSeries = item.seriesId ?? null;
      const r = await createAppointmentAction(workspaceSlug, {
        ...writableFields(item),
        seriesId: tempSeries ? (seriesIds.get(tempSeries) ?? tempSeries) : null,
        recurrence: item.recurrence ?? null,
      } as never);
      if (r.ok && tempSeries && r.data.seriesId) seriesIds.set(tempSeries, r.data.seriesId);
      return r;
    },
    update: (id, patch) => updateAppointmentAction(workspaceSlug, id, writableFields(patch) as never),
    remove: (id) => removeAppointmentAction(workspaceSlug, id),
  });
}
