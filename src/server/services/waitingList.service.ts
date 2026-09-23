import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getServerWaitingListRepository } from "@/server/repository/registry";
import {
  createWaitingListEntrySchema,
  type CreateWaitingListEntryInput,
} from "@/server/validation/waitingList.schema";
import type { WaitingListEntry } from "@/features/waitingList/types";
import { matchWaitingList } from "@/features/waitingList/matching";
import type { Appointment } from "@/features/appointments/types";

export async function listWaitingList(session: Session): Promise<WaitingListEntry[]> {
  assertCan(session.role, "appointments.view");
  return getServerWaitingListRepository(session.workspaceId).list();
}

export async function addWaitingListEntry(
  session: Session,
  input: CreateWaitingListEntryInput,
): Promise<WaitingListEntry> {
  assertCan(session.role, "appointments.create");
  const data = createWaitingListEntrySchema.parse(input);
  const entry: WaitingListEntry = { ...data, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
  await getServerWaitingListRepository(session.workspaceId).create(entry);
  return entry;
}

export async function findWaitingListMatches(
  session: Session,
  opened: Pick<Appointment, "service" | "staff" | "date" | "time">,
): Promise<WaitingListEntry[]> {
  assertCan(session.role, "appointments.view");
  const entries = await getServerWaitingListRepository(session.workspaceId).list();
  return matchWaitingList(opened, entries);
}
