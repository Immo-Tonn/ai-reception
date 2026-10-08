import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir } from "./pg";

const OWNER_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OWNER_B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const CLIENT_1 = "11111111-0000-4000-8000-000000000001";
const CLIENT_2 = "22222222-0000-4000-8000-000000000002";

let db: PGlite;
let wsA: string, wsB: string, svcA: string, staffA: string, staffA2: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const svc = { kind: "service" } as const;
const rpc = <T = Record<string, unknown>>(fn: string, args: unknown[], actor: Parameters<typeof as>[1] = svc) =>
  as(db, actor, async () => (await db.query<T>(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")})`, args)).rows);

const future = (days: number, hour = 10) => {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};

/** A public booking, exactly as the guest flow creates it. */
async function book(ws: string, service: string, staff: string, startsAt: string, email: string) {
  const r = await rpc<{ out_appointment_id: string }>("create_public_booking", [ws, service, staff, null, startsAt, "Guest", email, "", ""]);
  return r[0].out_appointment_id;
}
const claimToken = async (appointmentId: string) => (await rpc<{ issue_booking_claim: string }>("issue_booking_claim", [appointmentId]))[0].issue_booking_claim;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER_A}','a@t.invalid'),('${OWNER_B}','b@t.invalid'),('${CLIENT_1}','c1@t.invalid'),('${CLIENT_2}','c2@t.invalid')`);
  const prov = async (u: string, e: string, n: string, b: string) =>
    (await rpc<{ out_workspace_id: string }>("provision_workspace", [u, e, "", n, b, "en"]))[0].out_workspace_id;
  wsA = await prov(OWNER_A, "a@t.invalid", "Biz A", "biz-a");
  wsB = await prov(OWNER_B, "b@t.invalid", "Biz B", "biz-b");
  svcA = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Cut',30,40) returning id", [wsA]))[0].id;
  staffA = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsA]))[0].id;
  staffA2 = (await q<{ id: string }>("insert into staff_profiles (workspace_id,name) values ($1,'Second') returning id", [wsA]))[0].id;
}, 90_000);
afterAll(async () => db.close());

describe("0018 object privileges", () => {
  it("booking_claims is unreachable with the anon or authenticated key", async () => {
    for (const actor of [{ kind: "anon" }, { kind: "user", id: CLIENT_1 }] as const) {
      await expect(as(db, actor, () => db.query("select * from public.booking_claims"))).rejects.toThrow();
    }
  });
  it("the new functions are service-role only", async () => {
    const id = "00000000-0000-4000-8000-000000000000";
    for (const actor of [{ kind: "anon" }, { kind: "user", id: CLIENT_1 }] as const) {
      await expect(rpc("list_my_bookings", [CLIENT_1, 10], actor)).rejects.toThrow();
      await expect(rpc("cancel_my_booking", [CLIENT_1, id], actor)).rejects.toThrow();
      await expect(rpc("claim_booking", [CLIENT_1, "x".repeat(64)], actor)).rejects.toThrow();
      await expect(rpc("issue_booking_claim", [id], actor)).rejects.toThrow();
    }
  });
  it("client_accounts: a person sees and edits only their own row; anon sees nothing", async () => {
    await as(db, { kind: "user", id: CLIENT_1 }, () => db.exec(`insert into client_accounts (user_id, full_name) values ('${CLIENT_1}','One')`));
    await as(db, { kind: "user", id: CLIENT_2 }, () => db.exec(`insert into client_accounts (user_id, full_name) values ('${CLIENT_2}','Two')`));
    await expect(as(db, { kind: "user", id: CLIENT_1 }, () => db.exec(`insert into client_accounts (user_id) values ('${CLIENT_2}')`))).rejects.toThrow();
    const seen = await as(db, { kind: "user", id: CLIENT_1 }, async () => (await db.query<{ user_id: string }>("select user_id from client_accounts")).rows);
    expect(seen).toEqual([{ user_id: CLIENT_1 }]);
    await as(db, { kind: "user", id: CLIENT_1 }, () => db.exec(`update client_accounts set full_name='Hacked' where user_id='${CLIENT_2}'`));
    expect((await q<{ full_name: string }>("select full_name from client_accounts where user_id=$1", [CLIENT_2]))[0].full_name).toBe("Two");
    await expect(as(db, { kind: "anon" }, () => db.query("select * from client_accounts"))).rejects.toThrow();
  });
  it("business members cannot read client accounts or claims of their customers", async () => {
    const rows = await as(db, { kind: "user", id: OWNER_A }, async () => (await db.query("select * from client_accounts")).rows);
    expect(rows).toEqual([]);
    await expect(as(db, { kind: "user", id: OWNER_A }, () => db.query("select * from booking_claims"))).rejects.toThrow();
  });
});

describe("0018 claim + list + cancel + reschedule", () => {
  let a1: string, t1: string;

  it("a booking can be claimed with its token and then appears in My bookings with customer-safe fields only", async () => {
    a1 = await book(wsA, svcA, staffA, future(5), "guest1@t.invalid");
    t1 = await claimToken(a1);
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    // Only the hash is stored.
    expect(JSON.stringify(await q("select * from booking_claims"))).not.toContain(t1);

    expect(await rpc("list_my_bookings", [CLIENT_1, 50])).toEqual([]);
    await rpc("claim_booking", [CLIENT_1, t1]);
    const rows = await rpc<Record<string, unknown>>("list_my_bookings", [CLIENT_1, 50]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ out_appointment_id: a1, out_workspace_slug: "biz-a", out_service_name: "Cut", out_status: "pending" });
    // No internal columns leak.
    expect(Object.keys(rows[0]).join(",")).not.toMatch(/notes|internal|bucket|visibility|created_by|email|phone/);
  });

  it("Client 2 cannot see Client 1's booking, nor claim it with a guessed or foreign token", async () => {
    expect(await rpc("list_my_bookings", [CLIENT_2, 50])).toEqual([]);
    await expect(rpc("claim_booking", [CLIENT_2, t1])).rejects.toThrow(/claim_used/);
    await expect(rpc("claim_booking", [CLIENT_2, "0".repeat(64)])).rejects.toThrow(/not_found/);
    expect(await rpc("list_my_bookings", [CLIENT_2, 50])).toEqual([]);
  });

  it("claiming is idempotent for the same account", async () => {
    await rpc("claim_booking", [CLIENT_1, t1]);
    expect(await rpc("list_my_bookings", [CLIENT_1, 50])).toHaveLength(1);
  });

  it("an expired token cannot be claimed", async () => {
    const a = await book(wsA, svcA, staffA, future(6), "guest2@t.invalid");
    const t = await claimToken(a);
    await db.exec(`update booking_claims set expires_at = now() - interval '1 minute' where appointment_id='${a}'`);
    await expect(rpc("claim_booking", [CLIENT_1, t])).rejects.toThrow(/not_found/);
  });

  it("claiming one booking does NOT expose the same ClientRecord's other appointments (typed-e-mail attack)", async () => {
    // Victim has a booking under victim@... ; the attacker books with the SAME e-mail and claims only theirs.
    const victim = await book(wsA, svcA, staffA, future(7), "victim@t.invalid");
    await claimToken(victim); // victim never claims it
    const attacker = await book(wsA, svcA, staffA, future(8), "victim@t.invalid"); // same ClientRecord
    const tk = await claimToken(attacker);
    await rpc("claim_booking", [CLIENT_2, tk]);
    const ids = (await rpc<{ out_appointment_id: string }>("list_my_bookings", [CLIENT_2, 50])).map((r) => r.out_appointment_id);
    expect(ids).toEqual([attacker]);
    expect(ids).not.toContain(victim);
  });

  it("private / owner-only appointments are never listed", async () => {
    const a = await book(wsA, svcA, staffA, future(9), "guest3@t.invalid");
    const t = await claimToken(a);
    await rpc("claim_booking", [CLIENT_1, t]);
    await db.exec(`update appointments set visibility='private' where id='${a}'`);
    const ids = (await rpc<{ out_appointment_id: string }>("list_my_bookings", [CLIENT_1, 50])).map((r) => r.out_appointment_id);
    expect(ids).not.toContain(a);
    await expect(rpc("cancel_my_booking", [CLIENT_1, a])).rejects.toThrow(/not_found/);
  });

  it("Client 2 cannot cancel or reschedule Client 1's booking", async () => {
    await expect(rpc("cancel_my_booking", [CLIENT_2, a1])).rejects.toThrow(/not_found/);
    await expect(rpc("reschedule_my_booking", [CLIENT_2, a1, future(5, 12), staffA, null])).rejects.toThrow(/not_found/);
    expect((await q<{ status: string }>("select status::text as status from appointments where id=$1", [a1]))[0].status).toBe("pending");
  });

  it("a booking of another workspace is invisible to a client who has no claim there", async () => {
    const svcB = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Other',30,10) returning id", [wsB]))[0].id;
    const staffB = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsB]))[0].id;
    const b = await book(wsB, svcB, staffB, future(5), "guestb@t.invalid");
    await claimToken(b);
    const slugs = (await rpc<{ out_workspace_slug: string }>("list_my_bookings", [CLIENT_1, 50])).map((r) => r.out_workspace_slug);
    expect(slugs.every((s) => s === "biz-a")).toBe(true);
  });

  it("reschedule moves only to a free slot; the business sees it at once; the move is audited", async () => {
    const newStart = future(5, 12);
    const r = await rpc<{ out_starts_at: string; out_status: string }>("reschedule_my_booking", [CLIENT_1, a1, newStart, staffA, null]);
    expect(new Date(r[0].out_starts_at).toISOString()).toBe(newStart);
    expect((await q<{ starts_at: string }>("select starts_at from appointments where id=$1", [a1]))[0].starts_at).toBeTruthy();
    expect(await q("select action, source from audit_logs where entity_id=$1 and action='moved'", [a1])).toEqual([{ action: "moved", source: "public" }]);

    // Occupy a slot for the same person, then try to move onto it: the database refuses.
    await book(wsA, svcA, staffA, future(5, 14), "other@t.invalid");
    await expect(rpc("reschedule_my_booking", [CLIENT_1, a1, future(5, 14), staffA, null])).rejects.toThrow();
    // Unchanged after the refusal.
    expect(new Date((await q<{ starts_at: string }>("select starts_at from appointments where id=$1", [a1]))[0].starts_at).toISOString()).toBe(newStart);
    // A different person at the same time is fine.
    await rpc("reschedule_my_booking", [CLIENT_1, a1, future(5, 14), staffA2, null]);
  });

  it("reschedule rejects past times and staff of another business", async () => {
    await expect(rpc("reschedule_my_booking", [CLIENT_1, a1, new Date(Date.now() - 3600_000).toISOString(), staffA, null])).rejects.toThrow(/invalid_time/);
    const staffB = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsB]))[0].id;
    await expect(rpc("reschedule_my_booking", [CLIENT_1, a1, future(6, 9), staffB, null])).rejects.toThrow(/staff_unavailable/);
  });

  it("cancel works once, frees the slot, is audited, and is final", async () => {
    await rpc("cancel_my_booking", [CLIENT_1, a1]);
    expect((await q<{ status: string }>("select status::text as status from appointments where id=$1", [a1]))[0].status).toBe("cancelled");
    expect(await q("select source from audit_logs where entity_id=$1 and action='cancelled'", [a1])).toEqual([{ source: "public" }]);
    await expect(rpc("cancel_my_booking", [CLIENT_1, a1])).rejects.toThrow(/not_manageable/);
    // Still listed (as cancelled) so the client sees what happened.
    const mine = await rpc<{ out_appointment_id: string; out_status: string }>("list_my_bookings", [CLIENT_1, 50]);
    expect(mine.find((r) => r.out_appointment_id === a1)?.out_status).toBe("cancelled");
  });

  it("a booking in the past cannot be cancelled or moved", async () => {
    const a = await book(wsA, svcA, staffA, future(3, 8), "guest4@t.invalid");
    const t = await claimToken(a);
    await rpc("claim_booking", [CLIENT_1, t]);
    await db.exec(`update appointments set starts_at = now() - interval '2 hours', ends_at = now() - interval '90 minutes' where id='${a}'`);
    await expect(rpc("cancel_my_booking", [CLIENT_1, a])).rejects.toThrow(/not_manageable/);
  });
});

describe("0018 replay-safety and existing data", () => {
  it("running 0018 again changes nothing", async () => {
    const before = await q("select count(*)::int as n from booking_claims");
    await db.exec(readFileSync(path.join(migrationsDir, "0018_client_accounts_and_my_bookings.sql"), "utf8"));
    expect(await q("select count(*)::int as n from booking_claims")).toEqual(before);
  });
  it("the business side still sees the appointments and clients normally", async () => {
    const rows = await as(db, { kind: "user", id: OWNER_A }, async () => (await db.query<{ id: string }>("select id from appointments")).rows);
    expect(rows.length).toBeGreaterThan(0);
    const other = await as(db, { kind: "user", id: OWNER_B }, async () => (await db.query<{ workspace_id: string }>("select workspace_id from appointments")).rows);
    expect(other.every((r) => r.workspace_id === wsB)).toBe(true);
  });
});
