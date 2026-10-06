import "server-only";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { demoWorkingHours } from "@/features/workingHours/demoData";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import { getSupabaseWorkingHours } from "./supabase/workingHoursRepository";

/**
 * Working hours the availability engine and the booking rules run
 * against: the fixed demo schedule for the four demo presets, the real
 * `working_hours` rows for every real workspace.
 */
export async function getServerWorkingHours(workspaceId: string): Promise<WorkingHoursProfile[]> {
  if (isDemoWorkspaceSlug(workspaceId)) return demoWorkingHours;
  return getSupabaseWorkingHours(workspaceId);
}
