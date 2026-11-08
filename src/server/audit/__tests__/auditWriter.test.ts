import { afterEach, describe, expect, it, vi } from "vitest";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, AuditWriteError, writeAuditEntry, type AuditWriteInput, type AuditWriterDeps } from "../auditWriter";

const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const input = (over: Partial<AuditWriteInput> = {}): AuditWriteInput => ({
  workspaceId: WS, action: "created", entityType: "client", entityId: "c-1", summary: "Created", ...over,
});

function deps(over: Partial<AuditWriterDeps> = {}) {
  const inserted: Parameters<AuditWriterDeps["insert"]>[0][] = [];
  const d: AuditWriterDeps = {
    getUserId: async () => USER,
    isWorkspaceMember: async () => true,
    insert: async (row) => {
      inserted.push(row);
      return null;
    },
    ...over,
  };
  return { d, inserted };
}

afterEach(() => vi.restoreAllMocks());

describe("audit writer (the only application path into audit_logs)", () => {
  it("writes one row: actor = the verified user, source always user", async () => {
    const { d, inserted } = deps();
    await writeAuditEntry(input(), d);
    expect(inserted).toEqual([{ workspace_id: WS, actor_id: USER, action: "created", entity_type: "client", entity_id: "c-1", summary: "Created", source: "user" }]);
  });

  it("the caller cannot choose actor or source (extra fields are not forwarded)", async () => {
    const { d, inserted } = deps();
    await writeAuditEntry({ ...input(), actor_id: "someone-else", source: "automation" } as unknown as AuditWriteInput, d);
    expect(inserted[0].actor_id).toBe(USER);
    expect(inserted[0].source).toBe("user");
  });

  it("refuses without a verified user and writes nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { d, inserted } = deps({ getUserId: async () => null });
    await expect(writeAuditEntry(input(), d)).rejects.toMatchObject({ name: "AuditWriteError", code: "not_authenticated" });
    expect(inserted).toHaveLength(0);
  });

  it("refuses a user who is not a member of the workspace", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { d, inserted } = deps({ isWorkspaceMember: async () => false });
    await expect(writeAuditEntry(input(), d)).rejects.toMatchObject({ code: "not_a_member" });
    expect(inserted).toHaveLength(0);
  });

  it("checks membership of exactly the workspace and user it writes for", async () => {
    const seen: [string, string][] = [];
    const { d } = deps({ isWorkspaceMember: async (w, u) => (seen.push([w, u]), true) });
    await writeAuditEntry(input(), d);
    expect(seen).toEqual([[WS, USER]]);
  });

  it("allows only the fixed action and entity type lists", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { d, inserted } = deps();
    await expect(writeAuditEntry(input({ action: "exported" as never }), d)).rejects.toMatchObject({ code: "invalid_action" });
    await expect(writeAuditEntry(input({ entityType: "payroll" as never }), d)).rejects.toMatchObject({ code: "invalid_entity_type" });
    await expect(writeAuditEntry(input({ workspaceId: "not-a-uuid" }), d)).rejects.toMatchObject({ code: "invalid_workspace" });
    await expect(writeAuditEntry(input({ entityId: "" }), d)).rejects.toMatchObject({ code: "invalid_entity_id" });
    await expect(writeAuditEntry(input({ entityId: "x".repeat(201) }), d)).rejects.toMatchObject({ code: "invalid_entity_id" });
    expect(inserted).toHaveLength(0);
    for (const a of AUDIT_ACTIONS) for (const e of AUDIT_ENTITY_TYPES.slice(0, 2)) await writeAuditEntry(input({ action: a, entityType: e }), d);
    expect(inserted).toHaveLength(AUDIT_ACTIONS.length * 2);
  });

  it("cuts the summary to 500 characters", async () => {
    const { d, inserted } = deps();
    await writeAuditEntry(input({ summary: "a".repeat(900) }), d);
    expect(inserted[0].summary).toHaveLength(500);
  });

  it("logs a failure by code only — no workspace, entity, summary or error message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { d } = deps({ insert: async () => ({ code: "23503" }) });
    await expect(writeAuditEntry(input({ summary: "Anna Müller anna@example.com", entityId: "client-secret-id" }), d)).rejects.toBeInstanceOf(AuditWriteError);
    expect(log).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("23503");
    expect(logged).not.toMatch(/Anna|example\.com|client-secret-id|1111/);
  });

  it("does not leak the underlying error message of a thrown dependency", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { d } = deps({ insert: async () => { throw new Error("connection to db.secret.host failed for anna@example.com"); } });
    const err = (await writeAuditEntry(input(), d).then(() => null, (e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(AuditWriteError);
    expect(JSON.stringify([err.message, log.mock.calls])).not.toMatch(/secret\.host|anna@/);
  });
});
