"use server";

import { getSession } from "@/server/auth/session";
import * as waitingListService from "@/server/services/waitingList.service";
import { runAction, type ActionResult } from "./result";
import type { CreateWaitingListEntryInput, UpdateWaitingListEntryInput } from "@/server/validation/waitingList.schema";
import type { WaitingListEntry, WaitingListStatus } from "@/features/waitingList/types";

export async function listWaitingListAction(workspaceSlug: string): Promise<ActionResult<WaitingListEntry[]>> {
  return runAction(async () => waitingListService.listWaitingList(await getSession(workspaceSlug)));
}

export async function addWaitingListEntryAction(
  workspaceSlug: string,
  input: CreateWaitingListEntryInput,
): Promise<ActionResult<WaitingListEntry>> {
  return runAction(async () => waitingListService.addWaitingListEntry(await getSession(workspaceSlug), input));
}

export async function updateWaitingListEntryAction(
  workspaceSlug: string,
  id: string,
  input: UpdateWaitingListEntryInput,
): Promise<ActionResult<WaitingListEntry>> {
  return runAction(async () => waitingListService.updateWaitingListEntry(await getSession(workspaceSlug), id, input));
}

export async function setWaitingListStatusAction(
  workspaceSlug: string,
  id: string,
  status: WaitingListStatus,
): Promise<ActionResult<WaitingListEntry>> {
  return runAction(async () => waitingListService.setWaitingListStatus(await getSession(workspaceSlug), id, status));
}
