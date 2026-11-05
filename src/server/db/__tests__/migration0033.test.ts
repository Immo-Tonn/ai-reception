import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir, type Actor } from "./pg";

const OWNER_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const svc: Actor = { kind: "service" };
const anon: Actor = { kind: "anon" };
const owner: Actor = { kind: "user", id: OWNER_A };

let db: PGlite;
let wsA: string;

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
const save = async (subscription: string, status: string, plan: string | null = "start", actor: Actor = svc) =>
  (
    await run<{ saved: boolean }>(actor, "select public.save_workspace_subscription($1,'cus_1',$2,$3,$4) as saved", [wsA, subscription, plan, status])
  )[0].saved;
const stored = async () =>
  (await db.query<{ stripe_subscription_id: string; plan: string | null; status: string }>("select * from workspace_subscriptions where workspace_id=$1", [wsA])).rows[0];

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER_A}','a@t.invalid')`);
  wsA = (await run<{ out_workspace_id: string }>(svc, "select * from public.provision_workspace($1,$2,'',$3,$4,'en')", [OWNER_A, "a@t.invalid", "Biz A", "sub-a"]))[0].out_workspace_id;
}, 120_000); // replaying every migration can take longer than the 10 s default under a full parallel run

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.query("delete from workspace_subscriptions");
});

describe("0033 workspace subscriptions", () => {
  it("is idempotent (re-running the file is harmless)", async () => {
    await save("sub_1", "active");
    await db.exec(readFileSync(path.join(migrationsDir, "0033_workspace_subscriptions.sql"), "utf8"));
    expect((await stored()).stripe_subscription_id).toBe("sub_1");
  });

  it("is service-role only: even the workspace owner has no direct access", async () => {
    await save("sub_1", "active");
    expect(await codeOf(run(anon, "select * from workspace_subscriptions"))).toBe("42501");
    expect(await codeOf(run(owner, "select * from workspace_subscriptions"))).toBe("42501");
    expect(await codeOf(run(owner, "update workspace_subscriptions set plan='pro'"))).toBe("42501");
    expect(await codeOf(save("sub_2", "active", "pro", anon))).toBe("42501");
    expect(await codeOf(save("sub_2", "active", "pro", owner))).toBe("42501");
    expect((await stored()).plan).toBe("start");
  });

  it("updates the stored subscription: plan change, then cancellation", async () => {
    expect(await save("sub_1", "active", "start")).toBe(true);
    expect(await save("sub_1", "active", "pro")).toBe(true);
    expect((await stored()).plan).toBe("pro");
    expect(await save("sub_1", "canceled", "pro")).toBe(true);
    expect((await stored()).status).toBe("canceled");
  });

  it("a late event about an old subscription never overwrites the live one", async () => {
    await save("sub_old", "canceled");
    expect(await save("sub_new", "active", "pro")).toBe(true);
    expect(await save("sub_old", "canceled", "start")).toBe(false);
    expect(await stored()).toMatchObject({ stripe_subscription_id: "sub_new", status: "active", plan: "pro" });
  });

  it("a duplicate purchase never replaces the subscription already being paid for", async () => {
    await save("sub_1", "active", "start");
    expect(await save("sub_2", "active", "pro")).toBe(false);
    expect((await stored()).stripe_subscription_id).toBe("sub_1");
  });

  it("rejects malformed ids and unknown plans", async () => {
    expect(await codeOf(save("not-a-sub", "active"))).toBe("23514");
    expect(await codeOf(save("sub_1", "active", "gold"))).toBe("23514");
  });

  it("reports an unknown workspace as a foreign key violation (handled by the webhook)", async () => {
    const code = await codeOf(
      run(svc, "select public.save_workspace_subscription(gen_random_uuid(),'cus_1','sub_1','start','active')"),
    );
    expect(code).toBe("23503");
  });

  it("is removed together with its workspace (on delete cascade)", async () => {
    const rule = await db.query<{ confdeltype: string }>("select confdeltype from pg_constraint where conrelid='public.workspace_subscriptions'::regclass and contype='f'");
    expect(rule.rows[0].confdeltype).toBe("c");
  });
});
