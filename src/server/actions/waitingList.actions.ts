"use server";

import { getSession } from "@/server/auth/session";
import * as waitingListService from "@/server/services/waitingList.service";
import type { CreateWaitingListEntryInput } from "@/server/validation/waitingList.schema";

export async function listWaitingListAction(workspaceId: string) {
  const session = await getSession(workspaceId);
  return waitingListService.listWaitingList(session);
}

export async function addWaitingListEntryAction(
  workspaceId: string,
  input: CreateWaitingListEntryInput,
) {
  const session = await getSession(workspaceId);
  return waitingListService.addWaitingListEntry(session, input);
}
