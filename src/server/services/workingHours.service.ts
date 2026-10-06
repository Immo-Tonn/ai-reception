import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getServerWorkingHours } from "@/server/repository/workingHours";
import { saveBusinessWorkingHours } from "@/server/repository/supabase/workingHoursRepository";
import { businessHoursSchema } from "@/server/validation/workingHours.schema";
import type { TimeRange } from "@/features/workingHours/types";

export async function getBusinessHours(session: Session): Promise<(TimeRange | null)[]> {
  const profiles = await getServerWorkingHours(session.workspaceId);
  const business = profiles.find((p) => p.ownerId === "business");
  return [0, 1, 2, 3, 4, 5, 6].map((day) => business?.weekly[day] ?? null);
}

export async function saveBusinessHours(session: Session, input: unknown): Promise<void> {
  assertCan(session.role, "settings.manage");
  const days = businessHoursSchema.parse(input);
  const weekly: Record<number, TimeRange | null> = {};
  days.forEach((range, index) => {
    weekly[index] = range;
  });
  await saveBusinessWorkingHours(session.workspaceId, weekly);
}
