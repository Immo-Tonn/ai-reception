"use server";

import { getSession } from "@/server/auth/session";
import * as staffService from "@/server/services/staff.service";
import type { CreateStaffInput, UpdateStaffInput } from "@/server/validation/staff.schema";
import type { StaffMember } from "@/features/staff/types";

export type StaffActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: "last_one" | "duplicate" | "generic" };

function toFailure(error: unknown): { ok: false; error: "last_one" | "duplicate" | "generic" } {
  if (error instanceof staffService.StaffRuleError && error.code !== "not_found") {
    return { ok: false, error: error.code };
  }
  console.error("[staff.actions]", error);
  return { ok: false, error: "generic" };
}

export async function listStaffAction(workspaceSlug: string): Promise<StaffMember[]> {
  const session = await getSession(workspaceSlug);
  return staffService.listStaff(session);
}

export async function createStaffAction(
  workspaceSlug: string,
  input: CreateStaffInput,
): Promise<StaffActionResult<StaffMember>> {
  try {
    const session = await getSession(workspaceSlug);
    return { ok: true, data: await staffService.createStaff(session, input) };
  } catch (error) {
    return toFailure(error);
  }
}

export async function updateStaffAction(
  workspaceSlug: string,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffActionResult<StaffMember | undefined>> {
  try {
    const session = await getSession(workspaceSlug);
    return { ok: true, data: await staffService.updateStaff(session, id, input) };
  } catch (error) {
    return toFailure(error);
  }
}

export async function removeStaffAction(
  workspaceSlug: string,
  id: string,
): Promise<StaffActionResult> {
  try {
    const session = await getSession(workspaceSlug);
    await staffService.removeStaff(session, id);
    return { ok: true, data: undefined };
  } catch (error) {
    return toFailure(error);
  }
}
