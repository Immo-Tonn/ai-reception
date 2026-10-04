"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/server/auth/session";
import * as service from "@/server/services/businessProfile.service";
import type { UpdateBusinessProfileInput } from "@/server/validation/businessProfile.schema";
import { runAction, type ActionResult } from "./result";

export async function updateBusinessProfileAction(
  workspaceSlug: string,
  input: UpdateBusinessProfileInput,
): Promise<ActionResult<service.BusinessProfile>> {
  const result = await runAction(async () => service.updateBusinessProfile(await getSession(workspaceSlug), input));
  // Header, switcher, settings and public pages all read the name from the DB.
  if (result.ok) revalidatePath(`/${workspaceSlug}`, "layout");
  if (result.ok) revalidatePath(`/book/${workspaceSlug}`, "layout");
  return result;
}
