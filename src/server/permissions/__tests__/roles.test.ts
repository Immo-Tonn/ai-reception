import { describe, expect, it } from "vitest";
import { can, assertCan, PermissionDeniedError, rolePermissions } from "../roles";

describe("can", () => {
  it("grants the owner every permission that exists in the matrix", () => {
    const allPermissions = new Set(Object.values(rolePermissions).flat());
    for (const permission of allPermissions) {
      expect(can("owner", permission)).toBe(true);
    }
  });

  it("denies staff access to finance", () => {
    expect(can("staff", "finance.view")).toBe(false);
  });

  it("denies staff and manager access to private records", () => {
    expect(can("staff", "private_records.view")).toBe(false);
    expect(can("manager", "private_records.view")).toBe(false);
  });

  it("grants the accountant finance visibility including private buckets", () => {
    expect(can("accountant", "finance.view")).toBe(true);
    expect(can("accountant", "financial_bucket.private.view")).toBe(true);
  });

  it("denies the accountant appointment editing", () => {
    expect(can("accountant", "appointments.edit")).toBe(false);
  });
});

describe("assertCan", () => {
  it("does not throw when the role has the permission", () => {
    expect(() => assertCan("owner", "billing.manage")).not.toThrow();
  });

  it("throws PermissionDeniedError when the role lacks the permission", () => {
    expect(() => assertCan("staff", "billing.manage")).toThrow(PermissionDeniedError);
  });
});
