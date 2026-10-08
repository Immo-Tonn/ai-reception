"use server";

import { getSession } from "@/server/auth/session";
import * as rules from "@/server/services/bookingRules.service";
import type { BookingRules } from "@/features/scheduling/types";
import type { BookingRulesInput } from "@/server/validation/scheduling.schema";
import { runAction, type ActionResult } from "./result";
import { revalidateScheduling } from "./schedulingRevalidate";

/** Booking rules (permission `settings.manage`; demo workspaces are refused -> "forbidden"). */
export async function updateBookingRulesAction(workspaceSlug: string, input: BookingRulesInput): Promise<ActionResult<BookingRules>> {
  const result = await runAction(async () => rules.updateBookingRules(await getSession(workspaceSlug), input));
  if (result.ok) revalidateScheduling(workspaceSlug);
  return result;
}
