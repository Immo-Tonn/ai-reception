import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a6";
const svc: Actor = { kind: "service" };
let db: PGlite;
let ws: string, staff: string;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) => as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const codeOf = async (p: Promise<unknown>) => p.then(() => undefined, (e: { code?: string }) => e.code ?? "no-code");

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o6@t.invalid')`);
  ws = (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'','Biz','m26','en')", [OWNER, "o6@t.invalid"]))[0].out_workspace_id;
  staff = (await db.query<{ id: string }>("select id from staff_profiles where workspace_id=$1", [ws])).rows[0].id;
}, 120_000); // replaying every migration can take longer than the 10 s default under a full parallel run
afterAll(() => db.close());

describe("0026 google_subject_hash", () => {
  it("is idempotent and additive (an existing connection keeps every value, the new column is NULL)", async () => {
    await run(svc, "insert into external_calendar_connections (workspace_id, staff_id, calendar_ids) values ($1,$2,$3)", [ws, staff, ["c1"]]);
    await db.exec(readFileSync(path.join(migrationsDir, "0026_external_calendar_subject.sql"), "utf8"));
    const [row] = (await db.query<{ calendar_ids: string[]; google_subject_hash: string | null }>("select calendar_ids, google_subject_hash from external_calendar_connections where staff_id=$1", [staff])).rows;
    expect(row).toEqual({ calendar_ids: ["c1"], google_subject_hash: null });
  });

  it("accepts only a 64-char lowercase hex HMAC", async () => {
    expect(await codeOf(run(svc, "update external_calendar_connections set google_subject_hash='1234567890' where staff_id=$1", [staff]))).toBe("23514");
    expect(await codeOf(run(svc, "update external_calendar_connections set google_subject_hash=$2 where staff_id=$1", [staff, "a".repeat(64)]))).toBeUndefined();
  });

  it("still service role only: anon and signed-in owners cannot read the hash", async () => {
    expect(await codeOf(run({ kind: "anon" }, "select google_subject_hash from external_calendar_connections"))).toBe("42501");
    expect(await codeOf(run({ kind: "user", id: OWNER }, "select google_subject_hash from external_calendar_connections"))).toBe("42501");
  });
});
