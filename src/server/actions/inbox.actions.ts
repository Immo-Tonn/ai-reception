"use server";

import { getSession } from "@/server/auth/session";
import * as inboxService from "@/server/services/inbox.service";
import { runAction, type ActionResult } from "./result";
import type { InboxEvent, InboxEventList } from "@/features/inbox/events";

export async function listInboxEventsAction(workspaceSlug: string): Promise<ActionResult<InboxEventList>> {
  return runAction(async () => inboxService.listInboxEvents(await getSession(workspaceSlug)));
}

export async function getInboxUnreadCountAction(workspaceSlug: string): Promise<ActionResult<number>> {
  return runAction(async () => inboxService.getInboxUnreadCount(await getSession(workspaceSlug)));
}

export async function setInboxEventReadAction(workspaceSlug: string, id: string, isRead: boolean): Promise<ActionResult<InboxEvent>> {
  return runAction(async () => inboxService.setInboxEventRead(await getSession(workspaceSlug), id, isRead === true));
}

export async function markAllInboxEventsReadAction(workspaceSlug: string): Promise<ActionResult<number>> {
  return runAction(async () => inboxService.markAllInboxEventsRead(await getSession(workspaceSlug)));
}
