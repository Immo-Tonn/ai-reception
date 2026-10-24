import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

const OWNER_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OWNER_B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const svc: Actor = { kind: "service" };
const anon: Actor = { kind: "anon" };
const user = (id: string): Actor => ({ kind: "user", id });

let db: PGlite;
let wsA: string, wsB: string, staffA: string, staffB: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const run = <T = Record<string, unknown>>(actor: Actor, sql: string, p: unknown[] = []) =>
  as(db, actor, async () => (await db.query<T>(sql, p)).rows);
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
};
const hash = (c: string) => c.repeat(64);

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER_A}','a@t.invalid'),('${OWNER_B}','b@t.invalid')`);
  const prov = async (u: string, e: string, n: string, slug: string) =>
    (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'',$3,$4,'en')", [u, e, n, slug]))[0].out_workspace_id;
  wsA = await prov(OWNER_A, "a@t.invalid", "Biz A", "ext-a");
  wsB = await prov(OWNER_B, "b@t.invalid", "Biz B", "ext-b");
  staffA = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsA]))[0].id;
  staffB = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsB]))[0].id;
}, 120_000); // replaying every migration can take longer than the 10 s default under a full parallel run

afterAll(async () => {
  await db.close();
});

describe("0025 external calendars: storage is service-role only", () => {
  it("is idempotent (re-running the file is harmless)", async () => {
    await db.exec(readFileSync(path.join(migrationsDir, "0025_external_calendars.sql"), "utf8"));
  });

  it("service role can store a connection; anon and the workspace owner cannot read or write it", async () => {
    await run(svc, "insert into external_calendar_connections (workspace_id, staff_id, refresh_token_ciphertext, calendar_ids) values ($1,$2,$3,$4)", [
      wsA,
      staffA,
      "v1.ciphertext-placeholder.x.y",
      ["primary@example.invalid"],
    ]);
    expect(await codeOf(run(anon, "select * from external_calendar_connections"))).toBe("42501");
    // Even the OWNER of workspace A has no direct access (tokens and busy time stay server-side).
    expect(await codeOf(run(user(OWNER_A), "select refresh_token_ciphertext from external_calendar_connections"))).toBe("42501");
    expect(await codeOf(run(user(OWNER_A), "update external_calendar_connections set status='revoked'"))).toBe("42501");
    expect(await codeOf(run(user(OWNER_A), "select * from external_calendar_invites"))).toBe("42501");
    expect(await codeOf(run(anon, "select public.claim_external_calendar_refresh(gen_random_uuid(), 30, 60)"))).toBe("42501");
    expect(await codeOf(run(user(OWNER_A), "select public.consume_external_calendar_invite(gen_random_uuid())"))).toBe("42501");
  });

  it("one connection per staff member; a staff member of another workspace is refused", async () => {
    expect(
      await codeOf(run(svc, "insert into external_calendar_connections (workspace_id, staff_id) values ($1,$2)", [wsA, staffA])),
    ).toBe("23505");
    expect(
      await codeOf(run(svc, "insert into external_calendar_connections (workspace_id, staff_id) values ($1,$2)", [wsA, staffB])),
    ).toBe("23514");
    expect(
      await codeOf(run(svc, "insert into external_calendar_invites (workspace_id, staff_id, token_hash, expires_at) values ($1,$2,$3, now() + interval '1 day')", [wsB, staffA, hash("a")])),
    ).toBe("23514");
  });

  it("rejects more than 10 calendars and a non-array busy cache", async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `c${i}`);
    expect(await codeOf(run(svc, "update external_calendar_connections set calendar_ids=$1 where staff_id=$2", [ids, staffA]))).toBe("23514");
    expect(await codeOf(run(svc, "update external_calendar_connections set busy_intervals='{}'::jsonb where staff_id=$1", [staffA]))).toBe("23514");
  });

  it("claim: one refresh at a time, back-off after an error, never for a revoked connection", async () => {
    const [{ id }] = await run<{ id: string }>(svc, "select id from external_calendar_connections where staff_id=$1", [staffA]);
    const claim = async (backoff: number) =>
      (await run<{ c: boolean }>(svc, "select public.claim_external_calendar_refresh($1, 30, $2) as c", [id, backoff]))[0].c;
    expect(await claim(60)).toBe(true);
    expect(await claim(60)).toBe(false); // already claimed
    await run(svc, "update external_calendar_connections set refresh_claimed_at=null, last_error_at=now() where id=$1", [id]);
    expect(await claim(60)).toBe(false); // backing off after an error
    expect(await claim(0)).toBe(true); // a booking commit ignores the back-off
    await run(svc, "update external_calendar_connections set refresh_claimed_at=null, status='revoked' where id=$1", [id]);
    expect(await claim(0)).toBe(false);
  });

  it("invites: a new link replaces unused ones; consumption is single use and expiry-checked", async () => {
    const issue = async (h: string, exp = "now() + interval '1 day'") =>
      (await run<{ id: string }>(svc, `select public.issue_external_calendar_invite($1,$2,$3,${exp},null) as id`, [wsA, staffA, h]))[0].id;
    const first = await issue(hash("b"));
    const second = await issue(hash("c"));
    const consume = async (id: string) => run(svc, "select * from public.consume_external_calendar_invite($1)", [id]);
    expect(await consume(first)).toHaveLength(0); // replaced by the newer link
    expect(await consume(second)).toHaveLength(1);
    expect(await consume(second)).toHaveLength(0); // already used
    expect(await codeOf(issue(hash("d"), "now() + interval '30 days'"))).toBe("22023");
    const expired = (await run<{ id: string }>(svc, "insert into external_calendar_invites (workspace_id, staff_id, token_hash, expires_at) values ($1,$2,$3, now() - interval '1 minute') returning id", [wsA, staffA, hash("e")]))[0].id;
    expect(await consume(expired)).toHaveLength(0);
  });

  it("removing a staff member removes their connection (no orphaned tokens)", async () => {
    const extra = (await q<{ id: string }>("insert into staff_profiles (workspace_id,name) values ($1,'Temp') returning id", [wsB]))[0].id;
    await run(svc, "insert into external_calendar_connections (workspace_id, staff_id) values ($1,$2)", [wsB, extra]);
    await q("delete from staff_profiles where id=$1", [extra]);
    expect(await q("select 1 from external_calendar_connections where staff_id=$1", [extra])).toHaveLength(0);
  });
});
