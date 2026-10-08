"use server";

import { getSession } from "@/server/auth/session";
import * as resources from "@/server/services/resourcesAdmin.service";
import type { ResourceRecord } from "@/features/scheduling/types";
import type { CreateResourceInput, UpdateResourceInput } from "@/server/validation/scheduling.schema";
import { runAction, type ActionResult } from "./result";
import { revalidateScheduling } from "./schedulingRevalidate";

/** Resource management (permission `staff.manage`; demo workspaces are refused -> "forbidden"). */
async function run<T>(workspaceSlug: string, fn: (session: Awaited<ReturnType<typeof getSession>>) => Promise<T>): Promise<ActionResult<T>> {
  const result = await runAction(async () => fn(await getSession(workspaceSlug)));
  if (result.ok) revalidateScheduling(workspaceSlug);
  return result;
}

export async function createResourceAction(workspaceSlug: string, input: CreateResourceInput): Promise<ActionResult<ResourceRecord>> {
  return run(workspaceSlug, (s) => resources.createResource(s, input));
}

export async function updateResourceAction(workspaceSlug: string, id: string, input: UpdateResourceInput): Promise<ActionResult<ResourceRecord>> {
  return run(workspaceSlug, (s) => resources.updateResource(s, id, input));
}

export async function setResourceActiveAction(workspaceSlug: string, id: string, active: boolean): Promise<ActionResult<ResourceRecord>> {
  return run(workspaceSlug, (s) => resources.setResourceActive(s, id, active));
}
