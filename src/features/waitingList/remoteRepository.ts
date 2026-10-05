import { createRemoteRepository } from "@/lib/repository/createRemoteRepository";
import type { Repository } from "@/lib/repository/types";
import {
  addWaitingListEntryAction,
  listWaitingListAction,
  setWaitingListStatusAction,
  updateWaitingListEntryAction,
} from "@/server/actions/waitingList.actions";
import type { WaitingListEntry } from "./types";

/** Waiting list of a REAL workspace: Server Actions over the shared database. Removing = closing (history stays). */
export function createRemoteWaitingListRepository(workspaceSlug: string): Repository<WaitingListEntry> {
  return createRemoteRepository<WaitingListEntry>({
    list: () => listWaitingListAction(workspaceSlug),
    create: (item) =>
      addWaitingListEntryAction(workspaceSlug, {
        client: item.client,
        clientId: item.clientId ?? null,
        guestPhone: item.guestPhone ?? "",
        guestEmail: item.guestEmail ?? "",
        service: item.service,
        serviceId: item.serviceId ?? null,
        preferredStaff: item.preferredStaff,
        preferredStaffId: item.preferredStaffId ?? null,
        earliestDate: item.earliestDate,
        latestDate: item.latestDate,
        preferredDays: item.preferredDays,
        preferredTimeStart: item.preferredTimeStart,
        preferredTimeEnd: item.preferredTimeEnd,
        notes: item.notes ?? "",
      }),
    update: (id, patch) =>
      updateWaitingListEntryAction(workspaceSlug, id, {
        ...(patch.client !== undefined ? { client: patch.client } : {}),
        ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
        ...(patch.guestPhone !== undefined ? { guestPhone: patch.guestPhone } : {}),
        ...(patch.guestEmail !== undefined ? { guestEmail: patch.guestEmail } : {}),
        ...(patch.serviceId !== undefined ? { serviceId: patch.serviceId } : {}),
        ...(patch.preferredStaffId !== undefined ? { preferredStaffId: patch.preferredStaffId } : {}),
        ...(patch.earliestDate !== undefined ? { earliestDate: patch.earliestDate } : {}),
        ...(patch.latestDate !== undefined ? { latestDate: patch.latestDate } : {}),
        ...(patch.preferredDays !== undefined ? { preferredDays: patch.preferredDays } : {}),
        ...(patch.preferredTimeStart !== undefined ? { preferredTimeStart: patch.preferredTimeStart } : {}),
        ...(patch.preferredTimeEnd !== undefined ? { preferredTimeEnd: patch.preferredTimeEnd } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.bookedAppointmentId !== undefined ? { bookedAppointmentId: patch.bookedAppointmentId } : {}),
      }),
    remove: (id) => setWaitingListStatusAction(workspaceSlug, id, "closed"),
  });
}
