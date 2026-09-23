/**
 * Role / permission matrix — SPEC.md §5, §70, and Calendar-followup §9.
 *
 * This is the SAME shape a real Supabase/Postgres-backed RLS policy set
 * will encode later (role → capability strings). Nothing here is
 * UI-only: `can()` is the single gate every server service calls before
 * touching data, so hiding a button in the UI is never the only
 * protection (§9 requirement).
 */

export type Role = "owner" | "admin" | "manager" | "staff" | "accountant";

export const roles: Role[] = ["owner", "admin", "manager", "staff", "accountant"];

export type Permission =
  | "appointments.view"
  | "appointments.create"
  | "appointments.edit"
  | "appointments.cancel"
  | "private_records.view"
  | "owner_records.view"
  | "finance.view"
  | "finance.edit"
  | "financial_bucket.main.view"
  | "financial_bucket.private.view"
  | "clients.view"
  | "clients.edit"
  | "staff.manage"
  | "settings.manage"
  | "billing.manage"
  | "audit_log.view";

/**
 * Role → granted permissions. A permission not listed for a role is
 * denied — services default-deny, they never default-allow.
 */
export const rolePermissions: Record<Role, Permission[]> = {
  owner: [
    "appointments.view",
    "appointments.create",
    "appointments.edit",
    "appointments.cancel",
    "private_records.view",
    "owner_records.view",
    "finance.view",
    "finance.edit",
    "financial_bucket.main.view",
    "financial_bucket.private.view",
    "clients.view",
    "clients.edit",
    "staff.manage",
    "settings.manage",
    "billing.manage",
    "audit_log.view",
  ],
  admin: [
    "appointments.view",
    "appointments.create",
    "appointments.edit",
    "appointments.cancel",
    "finance.view",
    "finance.edit",
    "financial_bucket.main.view",
    "clients.view",
    "clients.edit",
    "staff.manage",
    "settings.manage",
    "audit_log.view",
  ],
  manager: [
    "appointments.view",
    "appointments.create",
    "appointments.edit",
    "appointments.cancel",
    "financial_bucket.main.view",
    "clients.view",
    "clients.edit",
  ],
  staff: ["appointments.view", "appointments.create", "appointments.edit", "clients.view"],
  accountant: [
    "finance.view",
    "financial_bucket.main.view",
    "financial_bucket.private.view",
    "audit_log.view",
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw new PermissionDeniedError(role, permission);
  }
}

export class PermissionDeniedError extends Error {
  constructor(
    public role: Role,
    public permission: Permission,
  ) {
    super(`Role "${role}" lacks permission "${permission}".`);
    this.name = "PermissionDeniedError";
  }
}
