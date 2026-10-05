import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getServerAuditLogRepository, getServerWaitingListRepository } from "@/server/repository/registry";
import { RepositoryNotFoundError } from "@/server/repository/errors";
import {
  createWaitingListEntrySchema,
  updateWaitingListEntrySchema,
  waitingListStatusSchema,
  type CreateWaitingListEntryInput,
  type UpdateWaitingListEntryInput,
} from "@/server/validation/waitingList.schema";
import { isActiveWaitingStatus, type WaitingListEntry, type WaitingListStatus } from "@/features/waitingList/types";
import { matchWaitingList } from "@/features/waitingList/matching";
import type { Appointment } from "@/features/appointments/types";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { recordInboxEvent } from "./inbox.service";

export async function listWaitingList(session: Session): Promise<WaitingListEntry[]> {
  assertCan(session.role, "appointments.view");
  return getServerWaitingListRepository(session.workspaceId).list();
}

async function audit(session: Session, action: "created" | "updated" | "statusChanged", entityId: string, summary: string) {
  await getServerAuditLogRepository(session.workspaceId).create({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    action,
    entityType: "waitingListEntry",
    entityId,
    summary,
    source: "user",
  });
}

export async function addWaitingListEntry(
  session: Session,
  input: CreateWaitingListEntryInput,
): Promise<WaitingListEntry> {
  assertCan(session.role, "appointments.create");
  const data = createWaitingListEntrySchema.parse(input);
  const entry: WaitingListEntry = {
    id: isDemoWorkspaceSlug(session.workspaceId) ? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` : crypto.randomUUID(),
    client: data.client,
    clientId: data.clientId ?? null,
    guestPhone: data.guestPhone,
    guestEmail: data.guestEmail,
    service: data.service,
    serviceId: data.serviceId ?? null,
    preferredStaff: data.preferredStaff ?? null,
    preferredStaffId: data.preferredStaffId ?? null,
    earliestDate: data.earliestDate,
    latestDate: data.latestDate,
    preferredDays: data.preferredDays,
    preferredTimeStart: data.preferredTimeStart ?? null,
    preferredTimeEnd: data.preferredTimeEnd ?? null,
    notes: data.notes,
    status: "waiting",
    bookedAppointmentId: null,
  };
  const created = await getServerWaitingListRepository(session.workspaceId).create(entry);
  // One audit entry, no personal data (name/phone/e-mail stay out of the history text).
  await audit(session, "created", created.id, "Added to waiting list");
  const first = created.client.trim().split(/\s+/)[0] ?? "";
  await recordInboxEvent(session, {
    type: "waiting_list",
    code: "waiting.added",
    title: "Added to waiting list",
    preview: [first, created.service].filter(Boolean).join(" · "),
    entityType: "waitingListEntry",
    entityId: created.id,
    clientId: created.clientId ?? null,
    dedupeKey: `waiting:${created.id}:created`,
  });
  return created;
}

/** Edit an entry's details and/or status. One audit entry per call (status change wins over a plain update). */
export async function updateWaitingListEntry(
  session: Session,
  id: string,
  input: UpdateWaitingListEntryInput,
): Promise<WaitingListEntry> {
  assertCan(session.role, "appointments.edit");
  const patch = updateWaitingListEntrySchema.parse(input);
  const repo = getServerWaitingListRepository(session.workspaceId);
  const before = await repo.get(id);
  if (!before) throw new RepositoryNotFoundError("waitingList.update");
  const updated = await repo.update(id, patch as Partial<WaitingListEntry>);
  if (!updated) throw new RepositoryNotFoundError("waitingList.update");
  const statusChanged = patch.status !== undefined && patch.status !== before.status;
  if (statusChanged) await audit(session, "statusChanged", id, `Waiting list status: ${patch.status}`);
  else await audit(session, "updated", id, "Waiting list entry updated");
  return updated;
}

export async function setWaitingListStatus(session: Session, id: string, status: WaitingListStatus): Promise<WaitingListEntry> {
  return updateWaitingListEntry(session, id, { status: waitingListStatusSchema.parse(status) });
}

/** Active entries (waiting / contacted) that fit a slot that just opened. */
export async function findWaitingListMatches(
  session: Session,
  opened: Pick<Appointment, "service" | "staff" | "date" | "time">,
): Promise<WaitingListEntry[]> {
  assertCan(session.role, "appointments.view");
  const entries = await getServerWaitingListRepository(session.workspaceId).list();
  return matchWaitingList(opened, entries.filter((e) => isActiveWaitingStatus(e.status)));
}
