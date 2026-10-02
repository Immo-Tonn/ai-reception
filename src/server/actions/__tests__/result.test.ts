import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { runAction, toActionError } from "../result";
import { PermissionDeniedError } from "@/server/permissions/roles";
import { UnauthenticatedError, WorkspaceAccessError } from "@/server/auth/resolveSession";

describe("server action results", () => {
  it("maps known errors to stable codes", () => {
    expect(toActionError(new UnauthenticatedError())).toBe("unauthenticated");
    expect(toActionError(new WorkspaceAccessError("x"))).toBe("forbidden");
    expect(toActionError(new PermissionDeniedError("staff", "settings.manage"))).toBe("forbidden");
    expect(toActionError(new ZodError([]))).toBe("invalid_input");
    expect(toActionError(new Error("boom"))).toBe("unknown");
  });

  it("never returns raw error text to the browser", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runAction(async () => {
      throw new Error("password authentication failed for user postgres at db.internal:5432");
    });
    expect(result).toEqual({ ok: false, code: "unknown" });
    expect(JSON.stringify(result)).not.toContain("postgres");
    spy.mockRestore();
  });

  it("passes data through on success", async () => {
    expect(await runAction(async () => 42)).toEqual({ ok: true, data: 42 });
  });
});
