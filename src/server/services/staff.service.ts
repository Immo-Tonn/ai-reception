import "server-only";
import type { Session } from "@/server/auth/session";
import { assertCan } from "@/server/permissions/roles";
import { getServerStaffRepository } from "@/server/repository/registry";
import {
  createStaffSchema,
  updateStaffSchema,
  type CreateStaffInput,
  type UpdateStaffInput,
} from "@/server/validation/staff.schema";
import type { StaffMember } from "@/features/staff/types";

const PALETTE = [
  "--color-accent-blue",
  "--color-accent-mint",
  "--color-accent-peach",
  "--color-accent-lavender",
  "--color-accent-pink",
  "--color-accent-sky",
  "--color-accent-lime",
  "--color-accent-yellow",
];

/** Thrown for expected, user-facing failures (shown as-is by the UI layer). */
export class StaffRuleError extends Error {
  constructor(public code: "last_one" | "duplicate" | "not_found", message: string) {
    super(message);
    this.name = "StaffRuleError";
  }
}

export async function listStaff(session: Session): Promise<StaffMember[]> {
  return getServerStaffRepository(session.workspaceId).list();
}

export async function createStaff(session: Session, input: CreateStaffInput): Promise<StaffMember> {
  assertCan(session.role, "settings.manage");
  const data = createStaffSchema.parse(input);
  const repo = getServerStaffRepository(session.workspaceId);
  const existing = await repo.list();
  if (existing.some((s) => s.name.toLowerCase() === data.name.toLowerCase())) {
    throw new StaffRuleError("duplicate", "A specialist with this name already exists.");
  }
  return repo.create({
    id: crypto.randomUUID(),
    name: data.name,
    colorToken: PALETTE[existing.length % PALETTE.length],
  });
}

export async function updateStaff(
  session: Session,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember | undefined> {
  assertCan(session.role, "settings.manage");
  const patch = updateStaffSchema.parse(input);
  const repo = getServerStaffRepository(session.workspaceId);
  if (patch.name) {
    const existing = await repo.list();
    const lower = patch.name.toLowerCase();
    if (existing.some((s) => s.id !== id && s.name.toLowerCase() === lower)) {
      throw new StaffRuleError("duplicate", "A specialist with this name already exists.");
    }
  }
  return repo.update(id, patch);
}

export async function removeStaff(session: Session, id: string): Promise<void> {
  assertCan(session.role, "settings.manage");
  const repo = getServerStaffRepository(session.workspaceId);
  const existing = await repo.list();
  if (existing.length <= 1) {
    throw new StaffRuleError("last_one", "At least one specialist is required.");
  }
  await repo.remove(id);
}
