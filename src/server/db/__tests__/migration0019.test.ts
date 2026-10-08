import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite, types } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { as, createMigratedDb, migrationFiles, migrationsDir, type Actor } from "./pg";

const OWNER_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OWNER_B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const STAFF_USER = "cccccccc-0000-4000-8000-0000000000c3";
const CLIENT_1 = "11111111-0000-4000-8000-000000000001";

const owner = (id: string): Actor => ({ kind: "user", id });
const svcRole: Actor = { kind: "service" };

let db: PGlite;
let wsA: string, wsB: string;
let staffA: string, staffB: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const asUser = <T>(id: string, fn: () => Promise<T>) => as(db, owner(id), fn);
const uq = <T = Record<string, unknown>>(id: string, sql: string, p: unknown[] = []) =>
  asUser(id, async () => (await db.query<T>(sql, p)).rows);
const rpc = <T = Record<string, unknown>>(fn: string, args: unknown[], actor: Actor = svcRole) =>
  as(db, actor, async () => (await db.query<T>(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")})`, args)).rows);

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
};
const messageOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "";
  } catch (e) {
    return (e as Error).message;
  }
};

/** Absolute time relative to now. */
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
/** A business-timezone (Europe/Berlin) wall clock: today + `days` at `hhmm`, as an ISO instant. */
async function berlin(days: number, hhmm: string): Promise<string> {
  const r = await q<{ t: Date | string }>(
    "select (((now() at time zone 'Europe/Berlin')::date + $1::int) + $2::time) at time zone 'Europe/Berlin' as t",
    [days, hhmm],
  );
  return new Date(r[0].t).toISOString();
}

async function book(ws: string, service: string, staff: string, resource: string | null, startsAt: string, email = `g${Math.random().toString(36).slice(2)}@t.invalid`) {
  const r = await rpc<{ out_appointment_id: string; out_status: string }>("create_public_booking", [ws, service, staff, resource, startsAt, "Guest", email, "", ""]);
  return r[0];
}
const claim = async (appointmentId: string, user = CLIENT_1) => {
  const t = (await rpc<{ issue_booking_claim: string }>("issue_booking_claim", [appointmentId]))[0].issue_booking_claim;
  await rpc("claim_booking", [user, t]);
};
const newService = async (ws: string, name: string, extra = "") =>
  (await q<{ id: string }>(`insert into services (workspace_id,name,duration_minutes,price${extra ? ",required_resource_type" : ""}) values ($1,$2,30,10${extra ? ",'room'" : ""}) returning id`, [ws, name]))[0].id;
const newStaff = async (ws: string, name: string) =>
  (await q<{ id: string }>("insert into staff_profiles (workspace_id,name) values ($1,$2) returning id", [ws, name]))[0].id;
const newRoom = async (ws: string, name: string) =>
  (await q<{ id: string }>("insert into resources (workspace_id,name,type) values ($1,$2,'room') returning id", [ws, name]))[0].id;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER_A}','a@t.invalid'),('${OWNER_B}','b@t.invalid'),('${STAFF_USER}','s@t.invalid'),('${CLIENT_1}','c1@t.invalid')`);
  const prov = async (u: string, e: string, n: string, b: string) =>
    (await rpc<{ out_workspace_id: string }>("provision_workspace", [u, e, "", n, b, "en"]))[0].out_workspace_id;
  wsA = await prov(OWNER_A, "a@t.invalid", "Biz A", "biz-a");
  wsB = await prov(OWNER_B, "b@t.invalid", "Biz B", "biz-b");
  await db.exec(`insert into profiles (id,email) values ('${STAFF_USER}','s@t.invalid');
    insert into workspace_members (workspace_id, profile_id, role) values ('${wsA}','${STAFF_USER}','staff')`);
  staffA = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsA]))[0].id;
  staffB = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsB]))[0].id;
}, 90_000);
afterAll(async () => db.close());

describe("0019 defaults", () => {
  it("new workspaces get the documented booking-rule defaults", async () => {
    const w = (await q<Record<string, unknown>>("select * from workspaces where id=$1", [wsA]))[0];
    expect(w).toMatchObject({ min_notice_minutes: 0, max_horizon_days: 90, slot_interval_minutes: 15, cancellation_deadline_hours: 0, reschedule_deadline_hours: 0, auto_confirm_bookings: false });
  });
  it("staff and resources get the new column defaults", async () => {
    expect((await q("select title, sort_order, schedule_mode from staff_profiles where id=$1", [staffA]))[0]).toEqual({ title: "", sort_order: 0, schedule_mode: "inherit" });
    const r = await newRoom(wsA, "Default room");
    expect((await q("select description, sort_order from resources where id=$1", [r]))[0]).toEqual({ description: "", sort_order: 0 });
  });
  it("column limits are enforced", async () => {
    const bad = async (sql: string) => expect(await codeOf(db.query(sql, [wsA])), sql).toBe("23514");
    await bad("update workspaces set min_notice_minutes = -1 where id=$1");
    await bad("update workspaces set min_notice_minutes = 525601 where id=$1");
    await bad("update workspaces set max_horizon_days = 0 where id=$1");
    await bad("update workspaces set max_horizon_days = 181 where id=$1");
    await bad("update workspaces set slot_interval_minutes = 7 where id=$1");
    await bad("update workspaces set cancellation_deadline_hours = 721 where id=$1");
    await bad("update workspaces set reschedule_deadline_hours = -1 where id=$1");
    await bad(`update staff_profiles set title = '${"x".repeat(81)}' where workspace_id=$1`);
    await bad(`update staff_profiles set schedule_mode = 'weird' where workspace_id=$1`);
    await bad(`update resources set description = '${"x".repeat(301)}' where workspace_id=$1`);
  });
});

describe("0019 working_hours integrity", () => {
  it("the onboarding defaults (one interval per weekday, weekend off) are valid", async () => {
    const rows = await q("select weekday, is_day_off from working_hours where workspace_id=$1 and staff_id is null order by weekday", [wsA]);
    expect(rows).toHaveLength(7);
  });
  let staffA2Id: string;
  const staffA2 = () => staffA2Id;
  beforeAll(async () => {
    staffA2Id = await newStaff(wsA, "Second");
  });
  const ins = (ws: string, staff: string | null, wd: number, s: string | null, e: string | null, off = false) =>
    db.query("insert into working_hours (workspace_id,staff_id,weekday,start_time,end_time,is_day_off) values ($1,$2,$3,$4,$5,$6)", [ws, staff, wd, s, e, off]);

  it("rejects an interval whose end is not after its start", async () => {
    expect(await codeOf(ins(wsA, staffA, 2, "10:00", "10:00"))).toBe("23514");
    expect(await codeOf(ins(wsA, staffA, 2, "11:00", "10:00"))).toBe("23514");
    expect(await codeOf(ins(wsA, staffA, 2, null, "10:00"))).toBe("23514");
  });
  it("allows several non-overlapping intervals per weekday (touching is fine) and rejects overlaps", async () => {
    await ins(wsA, staffA, 2, "09:00", "12:00");
    await ins(wsA, staffA, 2, "12:00", "13:00");
    await ins(wsA, staffA, 2, "14:00", "18:00");
    expect(await messageOf(ins(wsA, staffA, 2, "11:00", "12:30"))).toMatch(/working_hours_overlap/);
    expect(await codeOf(ins(wsA, staffA, 2, "08:00", "19:00"))).toBe("23514"); // swallows all
    expect(await codeOf(ins(wsA, staffA, 2, "17:59", "18:30"))).toBe("23514");
    await ins(wsA, staffA, 2, "13:00", "14:00"); // fills the gap exactly
  });
  it("overlap is scoped to the same owner and weekday", async () => {
    await ins(wsA, staffA, 3, "09:00", "12:00");
    await ins(wsA, staffA2(), 3, "09:00", "12:00"); // other person
    expect(await codeOf(ins(wsA, null, 3, "09:00", "12:00"))).toBe("23514"); // business already has 09-18 on Wednesday
    await ins(wsA, staffA, 4, "09:00", "12:00"); // other weekday
  });
  it("a day-off row and intervals exclude each other on the same weekday and owner", async () => {
    expect(await messageOf(ins(wsA, staffA, 2, null, null, true))).toMatch(/working_hours_day_off_conflict/);
    await ins(wsA, staffA, 5, null, null, true);
    expect(await messageOf(ins(wsA, staffA, 5, "09:00", "10:00"))).toMatch(/working_hours_day_off_conflict/);
    // The business weekend rows from provisioning behave the same.
    expect(await codeOf(ins(wsA, null, 0, "09:00", "10:00"))).toBe("23514");
    // Another owner may work that weekday.
    await ins(wsA, staffA2(), 5, "09:00", "10:00");
  });
  it("updates are guarded too", async () => {
    const id = (await q<{ id: string }>("select id from working_hours where staff_id=$1 and weekday=2 and start_time='14:00'", [staffA]))[0].id;
    expect(await codeOf(db.query("update working_hours set start_time='12:30' where id=$1", [id]))).toBe("23514");
    expect(await codeOf(db.query("update working_hours set is_day_off=true where id=$1", [id]))).toBe("23514");
    await db.query("update working_hours set start_time='14:30' where id=$1", [id]); // self never conflicts
  });
});

describe("0019 time_off", () => {
  const ins = (ws: string, staff: string | null, sd: string, ed: string, st: string | null = null, et: string | null = null, reason = "") =>
    db.query("insert into time_off (workspace_id,staff_id,start_date,end_date,start_time,end_time,reason) values ($1,$2,$3,$4,$5,$6,$7)", [ws, staff, sd, ed, st, et, reason]);

  it("accepts full days, a multi-day range, a business closure and one partial day", async () => {
    await ins(wsA, staffA, "2030-01-10", "2030-01-10");
    await ins(wsA, staffA, "2030-02-01", "2030-02-14", null, null, "holiday");
    await ins(wsA, null, "2030-12-24", "2030-12-26", null, null, "closed");
    await ins(wsA, staffA, "2030-03-05", "2030-03-05", "13:00", "15:00");
  });
  it("rejects bad ranges", async () => {
    expect(await codeOf(ins(wsA, staffA, "2030-01-10", "2030-01-09"))).toBe("23514");
    expect(await codeOf(ins(wsA, staffA, "2030-01-10", "2030-01-10", "10:00", null))).toBe("23514");
    expect(await codeOf(ins(wsA, staffA, "2030-01-10", "2030-01-10", null, "10:00"))).toBe("23514");
    expect(await codeOf(ins(wsA, staffA, "2030-01-10", "2030-01-11", "10:00", "11:00"))).toBe("23514"); // partial must be one day
    expect(await codeOf(ins(wsA, staffA, "2030-01-10", "2030-01-10", "11:00", "11:00"))).toBe("23514");
    expect(await codeOf(ins(wsA, staffA, "2030-01-10", "2030-01-10", "12:00", "11:00"))).toBe("23514");
    expect(await codeOf(ins(wsA, staffA, "2030-01-10", "2030-01-10", null, null, "x".repeat(201)))).toBe("23514");
  });
  it("rejects staff of another workspace (cross-workspace reference)", async () => {
    expect(await messageOf(ins(wsA, staffB, "2030-01-10", "2030-01-10"))).toMatch(/cross_workspace_reference/);
    expect(await messageOf(ins(wsB, staffA, "2030-01-10", "2030-01-10"))).toMatch(/cross_workspace_reference/);
    expect(await codeOf(db.query("update time_off set staff_id=$1 where workspace_id=$2 and start_date='2030-01-10'", [staffB, wsA]))).toBe("23514");
  });
  it("deleting a staff member removes its time off (cascade), the business closure stays", async () => {
    const s = await newStaff(wsA, "Temp");
    await ins(wsA, s, "2030-06-01", "2030-06-01");
    await db.query("delete from staff_profiles where id=$1", [s]);
    expect(await q("select 1 from time_off where staff_id=$1", [s])).toHaveLength(0);
    expect((await q("select 1 from time_off where staff_id is null and workspace_id=$1", [wsA])).length).toBeGreaterThan(0);
  });
});

describe("0019 service_resources", () => {
  it("links a service to a resource of the same workspace only", async () => {
    const svc = await newService(wsA, "S-link", "room");
    const room = await newRoom(wsA, "R-link");
    const roomB = await newRoom(wsB, "RB");
    await db.query("insert into service_resources (service_id,resource_id) values ($1,$2)", [svc, room]);
    expect(await codeOf(db.query("insert into service_resources (service_id,resource_id) values ($1,$2)", [svc, roomB]))).toBe("23514");
    expect(await codeOf(db.query("insert into service_resources (service_id,resource_id) values ($1,$2)", [svc, room]))).toBe("23505");
  });
});

describe("0019 RLS: tenant isolation and roles", () => {
  let toA: string, srvA: string, roomA: string, whA: string;
  beforeAll(async () => {
    toA = (await q<{ id: string }>("insert into time_off (workspace_id,staff_id,start_date,end_date,reason) values ($1,$2,'2031-01-01','2031-01-01','private') returning id", [wsA, staffA]))[0].id;
    srvA = await newService(wsA, "S-rls", "room");
    roomA = await newRoom(wsA, "R-rls");
    await db.query("insert into service_resources (service_id,resource_id) values ($1,$2)", [srvA, roomA]);
    whA = (await q<{ id: string }>("select id from working_hours where workspace_id=$1 limit 1", [wsA]))[0].id;
  });

  it("the owner of A reads and writes time_off / service_resources of A", async () => {
    expect((await uq(OWNER_A, "select id from time_off where id=$1", [toA]))).toHaveLength(1);
    await uq(OWNER_A, "insert into time_off (workspace_id,staff_id,start_date,end_date) values ($1,$2,'2031-02-01','2031-02-02')", [wsA, staffA]);
    expect(await uq(OWNER_A, "select 1 from service_resources where service_id=$1", [srvA])).toHaveLength(1);
  });

  it("Workspace B cannot read Workspace A's data", async () => {
    for (const [table, where, p] of [
      ["time_off", "id=$1", toA],
      ["service_resources", "service_id=$1", srvA],
      ["staff_profiles", "id=$1", staffA],
      ["resources", "id=$1", roomA],
      ["working_hours", "id=$1", whA],
    ] as const) {
      expect(await uq(OWNER_B, `select 1 from ${table} where ${where}`, [p]), table).toHaveLength(0);
    }
  });

  it("Workspace B cannot insert into Workspace A", async () => {
    const attempts: Array<[string, unknown[]]> = [
      ["insert into time_off (workspace_id,staff_id,start_date,end_date) values ($1,null,'2031-03-01','2031-03-01')", [wsA]],
      ["insert into service_resources (service_id,resource_id) values ($1,$2)", [srvA, await newRoom(wsA, "R-extra")]],
      ["insert into staff_profiles (workspace_id,name) values ($1,'Intruder')", [wsA]],
      ["insert into resources (workspace_id,name,type) values ($1,'Intruder','room')", [wsA]],
      ["insert into working_hours (workspace_id,weekday,start_time,end_time) values ($1,1,'01:00','02:00')", [wsA]],
    ];
    for (const [sql, p] of attempts) expect(await codeOf(asUser(OWNER_B, () => db.query(sql, p))), sql).toBe("42501");
  });

  it("Workspace B cannot update or delete Workspace A's rows (zero rows touched)", async () => {
    await uq(OWNER_B, "update time_off set reason='hacked' where id=$1", [toA]);
    await uq(OWNER_B, "delete from time_off where id=$1", [toA]);
    await uq(OWNER_B, "delete from service_resources where service_id=$1", [srvA]);
    await uq(OWNER_B, "update staff_profiles set title='hacked' where id=$1", [staffA]);
    await uq(OWNER_B, "delete from staff_profiles where id=$1", [staffA]).catch(() => undefined);
    await uq(OWNER_B, "update resources set description='hacked' where id=$1", [roomA]);
    await uq(OWNER_B, "delete from resources where id=$1", [roomA]).catch(() => undefined);
    await uq(OWNER_B, "update working_hours set is_day_off=true where id=$1", [whA]);
    await uq(OWNER_B, "delete from working_hours where id=$1", [whA]);
    await uq(OWNER_B, "update workspaces set min_notice_minutes=999 where id=$1", [wsA]);
    expect((await q<{ reason: string }>("select reason from time_off where id=$1", [toA]))[0].reason).toBe("private");
    expect(await q("select 1 from service_resources where service_id=$1", [srvA])).toHaveLength(1);
    expect((await q<{ title: string }>("select title from staff_profiles where id=$1", [staffA]))[0].title).toBe("");
    expect((await q<{ description: string }>("select description from resources where id=$1", [roomA]))[0].description).toBe("");
    expect(await q("select 1 from working_hours where id=$1 and is_day_off=false", [whA])).toHaveLength(1);
    expect((await q<{ n: number }>("select min_notice_minutes as n from workspaces where id=$1", [wsA]))[0].n).toBe(0);
  });

  it("B cannot move its own row into A's workspace", async () => {
    const mine = (await q<{ id: string }>("insert into time_off (workspace_id,start_date,end_date) values ($1,'2031-04-01','2031-04-01') returning id", [wsB]))[0].id;
    expect(await codeOf(asUser(OWNER_B, () => db.query("update time_off set workspace_id=$1 where id=$2", [wsA, mine])))).toBe("42501");
  });

  it("a staff-role user (no staff.manage) can read but not write time_off / service_resources", async () => {
    expect(await uq(STAFF_USER, "select id from time_off where id=$1", [toA])).toHaveLength(1);
    expect(await uq(STAFF_USER, "select 1 from service_resources where service_id=$1", [srvA])).toHaveLength(1);
    expect(await codeOf(asUser(STAFF_USER, () => db.query("insert into time_off (workspace_id,start_date,end_date) values ($1,'2031-05-01','2031-05-01')", [wsA])))).toBe("42501");
    await uq(STAFF_USER, "update time_off set reason='x' where id=$1", [toA]);
    await uq(STAFF_USER, "delete from time_off where id=$1", [toA]);
    await uq(STAFF_USER, "delete from service_resources where service_id=$1", [srvA]);
    expect(await codeOf(asUser(STAFF_USER, async () => db.query("insert into service_resources (service_id,resource_id) values ($1,$2)", [srvA, await newRoom(wsA, "R-staff-try")])))).toBe("42501");
    expect((await q<{ reason: string }>("select reason from time_off where id=$1", [toA]))[0].reason).toBe("private");
    expect(await q("select 1 from service_resources where service_id=$1", [srvA])).toHaveLength(1);
  });

  it("a staff-role user cannot change the booking rules", async () => {
    await uq(STAFF_USER, "update workspaces set min_notice_minutes=500, max_horizon_days=5 where id=$1", [wsA]);
    expect(await q("select 1 from workspaces where id=$1 and min_notice_minutes=0 and max_horizon_days=90", [wsA])).toHaveLength(1);
  });

  it("the owner of A can change the booking rules (existing settings.manage policy)", async () => {
    await uq(OWNER_A, "update workspaces set min_notice_minutes=15, slot_interval_minutes=30 where id=$1", [wsA]);
    expect(await q("select 1 from workspaces where id=$1 and min_notice_minutes=15 and slot_interval_minutes=30", [wsA])).toHaveLength(1);
    await uq(OWNER_A, "update workspaces set min_notice_minutes=0, slot_interval_minutes=15 where id=$1", [wsA]);
  });

  it("the owner cannot forge created_by of someone else", async () => {
    expect(await codeOf(asUser(OWNER_A, () => db.query("insert into time_off (workspace_id,start_date,end_date,created_by) values ($1,'2031-06-01','2031-06-01',$2)", [wsA, OWNER_B])))).toBe("42501");
    await uq(OWNER_A, "insert into time_off (workspace_id,start_date,end_date,created_by) values ($1,'2031-06-01','2031-06-01',$2)", [wsA, OWNER_A]);
  });

  it("anon reads nothing and cannot call the new internals", async () => {
    const anon: Actor = { kind: "anon" };
    for (const t of ["time_off", "service_resources"]) {
      expect(await codeOf(as(db, anon, () => db.query(`select * from ${t}`))), t).toBe("42501");
      expect(await codeOf(as(db, anon, () => db.query(`insert into ${t} default values`))), t).toBe("42501");
    }
    expect(await codeOf(rpc("get_public_booking_catalog", ["biz-a"], anon))).toBe("42501");
    for (const actor of [anon, owner(OWNER_A)]) {
      for (const fn of ["guard_working_hours_integrity", "guard_scheduling_references", "guard_restrict_delete_with_appointments"]) {
        expect(await codeOf(as(db, actor, () => db.query(`select public.${fn}()`))), `${actor.kind} ${fn}`).toBe("42501");
      }
    }
    for (const actor of [anon, owner(OWNER_A)]) {
      expect(await codeOf(rpc("create_public_booking", [wsA, staffA, staffA, null, inHours(30), "x", "x@t.invalid", "", ""], actor))).toBe("42501");
      expect(await codeOf(rpc("cancel_my_booking", [CLIENT_1, staffA], actor))).toBe("42501");
      expect(await codeOf(rpc("reschedule_my_booking", [CLIENT_1, staffA, inHours(30), staffA, null], actor))).toBe("42501");
    }
  });
});

type Row = { id: string; name: string; title: string; mode: string; staffId: string };
type Catalog = {
  staff: Row[];
  resources: Row[];
  staffModes: Row[];
  services: Record<string, unknown>[];
  timeOff: Record<string, unknown>[];
  [key: string]: unknown;
};

describe("0019 public catalog", () => {
  let catalog: Catalog;
  beforeAll(async () => {
    const ws = (await q<{ id: string }>("insert into workspaces (slug,name,created_by) values ('cat-biz','Catalog biz',$1) returning id", [OWNER_A]))[0].id;
    await db.exec(`insert into financial_buckets (workspace_id,name,slug,kind,is_default) values ('${ws}','Main','main','main',true)`);
    const s1 = (await q<{ id: string }>("insert into staff_profiles (workspace_id,name,title,sort_order,schedule_mode) values ($1,'Zed','Master',2,'custom') returning id", [ws]))[0].id;
    const s2 = (await q<{ id: string }>("insert into staff_profiles (workspace_id,name,title,sort_order) values ($1,'Amy','Junior',1) returning id", [ws]))[0].id;
    await q("insert into staff_profiles (workspace_id,name,active) values ($1,'Gone',false)", [ws]);
    const r1 = (await q<{ id: string }>("insert into resources (workspace_id,name,type,sort_order) values ($1,'Room B','room',2) returning id", [ws]))[0].id;
    await q("insert into resources (workspace_id,name,type,sort_order) values ($1,'Room A','room',1)", [ws]);
    await q("insert into resources (workspace_id,name,type,active) values ($1,'Old room','room',false)", [ws]);
    const sv = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,required_resource_type) values ($1,'Svc',30,'room') returning id", [ws]))[0].id;
    await q("insert into service_resources (service_id,resource_id) values ($1,$2)", [sv, r1]);
    await q("insert into time_off (workspace_id,staff_id,start_date,end_date,reason) values ($1,$2,(now() at time zone 'Europe/Berlin')::date + 3,(now() at time zone 'Europe/Berlin')::date + 4,'SECRET-REASON')", [ws, s1]);
    await q("insert into time_off (workspace_id,start_date,end_date,start_time,end_time,reason) values ($1,(now() at time zone 'Europe/Berlin')::date + 5,(now() at time zone 'Europe/Berlin')::date + 5,'12:00','13:30','SECRET-2')", [ws]);
    await q("insert into time_off (workspace_id,start_date,end_date,reason) values ($1,'2020-01-01','2020-01-05','SECRET-OLD')", [ws]);
    await q("update workspaces set min_notice_minutes=60, max_horizon_days=30, slot_interval_minutes=20, auto_confirm_bookings=true where id=$1", [ws]);
    void s2;
    catalog = (await rpc<{ get_public_booking_catalog: Catalog }>("get_public_booking_catalog", ["cat-biz"]))[0].get_public_booking_catalog;
  });

  it("returns the rules, time off, staff modes and resource links; keeps every old key", async () => {
    expect(Object.keys(catalog)).toEqual(expect.arrayContaining(["workspace", "profile", "services", "staff", "resources", "workingHours"]));
    expect(catalog.workspace).toMatchObject({ slug: "cat-biz", autoConfirm: true });
    expect(catalog.rules).toEqual({ minNoticeMinutes: 60, maxHorizonDays: 30, slotIntervalMinutes: 20, autoConfirm: true });
    expect(catalog.services[0]?.resourceIds).toHaveLength(1);
    expect(catalog.services[0]).toMatchObject({ requiredResourceType: "room", allowedStaffIds: [] });
  });
  it("lists only active staff and resources, ordered by sort_order, with title and modes", async () => {
    expect(catalog.staff.map((s: Row) => s.name)).toEqual(["Amy", "Zed"]);
    expect(catalog.staff.map((s: Row) => s.title)).toEqual(["Junior", "Master"]);
    expect(catalog.resources.map((r: Row) => r.name)).toEqual(["Room A", "Room B"]);
    expect(catalog.staffModes.map((m: Row) => m.mode)).toEqual(["inherit", "custom"]);
    expect(catalog.staffModes.map((m: Row) => m.staffId)).toEqual(catalog.staff.map((s: Row) => s.id));
  });
  it("exposes time off without any reason and drops entries older than yesterday", async () => {
    expect(catalog.timeOff).toHaveLength(2);
    expect(catalog.timeOff[0]).toMatchObject({ startTime: null, endTime: null });
    expect(catalog.timeOff[1]).toMatchObject({ staffId: null, startTime: "12:00", endTime: "13:30" });
    const json = JSON.stringify(catalog);
    expect(json).not.toContain("SECRET");
    expect(json).not.toMatch(/reason|created_by|createdBy/);
  });
});

describe("0019 restrict-delete", () => {
  it("staff, resources and services referenced by appointments cannot be deleted; unused ones can", async () => {
    const svc = await newService(wsA, "Used svc", "room");
    const room = await newRoom(wsA, "Used room");
    const st = await newStaff(wsA, "Used staff");
    const appt = await book(wsA, svc, st, room, inHours(24 * 20 + 1));
    for (const [t, id] of [["staff_profiles", st], ["resources", room], ["services", svc]] as const) {
      expect(await codeOf(db.query(`delete from ${t} where id=$1`, [id])), t).toBe("23503");
      expect(await messageOf(db.query(`delete from ${t} where id=$1`, [id])), t).toMatch(/restrict_delete/);
    }
    // The owner (RLS applies) is refused as well, and history keeps its ids.
    expect(await codeOf(asUser(OWNER_A, () => db.query("delete from staff_profiles where id=$1", [st])))).toBe("23503");
    const row = (await q<{ staff_id: string; resource_id: string; service_id: string }>("select staff_id,resource_id,service_id from appointments where id=$1", [appt.out_appointment_id]))[0];
    expect(row).toEqual({ staff_id: st, resource_id: room, service_id: svc });
    // Cancelled history still blocks (nothing is silently nulled).
    await q("update appointments set status='cancelled' where id=$1", [appt.out_appointment_id]);
    expect(await codeOf(db.query("delete from staff_profiles where id=$1", [st]))).toBe("23503");

    const free = await newStaff(wsA, "Free staff");
    const freeRoom = await newRoom(wsA, "Free room");
    const freeSvc = await newService(wsA, "Free svc");
    await db.query("delete from staff_profiles where id=$1", [free]);
    await db.query("delete from resources where id=$1", [freeRoom]);
    await db.query("delete from services where id=$1", [freeSvc]);
  });

  it("deleting a whole workspace (cascade) still works, appointments included", async () => {
    const ws = (await q<{ id: string }>("insert into workspaces (slug,name,created_by) values ('doomed','Doomed',$1) returning id", [OWNER_A]))[0].id;
    await db.exec(`insert into financial_buckets (workspace_id,name,slug,kind,is_default) values ('${ws}','Main','main','main',true)`);
    const st = await newStaff(ws, "S");
    const room = await newRoom(ws, "R");
    const svc = await newService(ws, "V", "room");
    await book(ws, svc, st, room, inHours(24 * 21 + 2));
    await db.query("insert into time_off (workspace_id,staff_id,start_date,end_date) values ($1,$2,'2031-07-01','2031-07-01')", [ws, st]);
    await db.query("delete from workspaces where id=$1", [ws]);
    for (const t of ["staff_profiles", "resources", "services", "appointments", "time_off"]) {
      expect(await q(`select 1 from ${t} where workspace_id=$1`, [ws]), t).toHaveLength(0);
    }
  });
});

describe("0019 booking rules in create_public_booking", () => {
  let ws: string, st: string, svc: string, svcRoom: string, roomA: string, roomB: string;
  beforeAll(async () => {
    ws = (await q<{ id: string }>("insert into workspaces (slug,name,created_by) values ('rules-biz','Rules',$1) returning id", [OWNER_A]))[0].id;
    await db.exec(`insert into financial_buckets (workspace_id,name,slug,kind,is_default) values ('${ws}','Main','main','main',true)`);
    st = await newStaff(ws, "Rule staff");
    svc = await newService(ws, "Plain");
    svcRoom = await newService(ws, "Needs room", "room");
    roomA = await newRoom(ws, "RA");
    roomB = await newRoom(ws, "RB");
  });
  const setRules = (sql: string) => q(`update workspaces set ${sql} where id=$1`, [ws]);

  it("min notice: too soon is invalid_time, far enough is accepted", async () => {
    await setRules("min_notice_minutes = 180");
    expect(await messageOf(book(ws, svc, st, null, inHours(2)))).toMatch(/invalid_time/);
    expect(await codeOf(book(ws, svc, st, null, inHours(2)))).toBe("22023");
    expect(await codeOf(book(ws, svc, st, null, inHours(-1)))).toBe("22023");
    await book(ws, svc, st, null, inHours(4));
    await setRules("min_notice_minutes = 0");
  });

  it("horizon: the last bookable day is today + max_horizon_days (business timezone)", async () => {
    await setRules("max_horizon_days = 10");
    await book(ws, svc, st, null, await berlin(10, "23:00"));
    expect(await messageOf(book(ws, svc, st, null, await berlin(11, "00:30")))).toMatch(/invalid_time/);
    expect(await codeOf(book(ws, svc, st, null, await berlin(60, "10:00")))).toBe("22023");
    await setRules("max_horizon_days = 180");
    await book(ws, svc, st, null, await berlin(150, "10:00"));
    await setRules("max_horizon_days = 90");
    expect(await codeOf(book(ws, svc, st, null, await berlin(150, "11:00")))).toBe("22023");
  });

  it("linked resources: only a linked resource is allowed once a link exists", async () => {
    // No link yet: any active room of the type works.
    await book(ws, svcRoom, st, roomB, await berlin(5, "09:00"));
    await q("insert into service_resources (service_id,resource_id) values ($1,$2)", [svcRoom, roomA]);
    expect(await messageOf(book(ws, svcRoom, st, roomB, await berlin(5, "11:00")))).toMatch(/resource_unavailable/);
    await book(ws, svcRoom, st, roomA, await berlin(5, "11:00"));
    expect(await messageOf(book(ws, svcRoom, st, null, await berlin(5, "13:00")))).toMatch(/resource_unavailable/);
  });

  it("auto-confirm decides confirmed vs pending", async () => {
    await setRules("auto_confirm_bookings = false");
    expect((await book(ws, svc, st, null, await berlin(6, "09:00"))).out_status).toBe("pending");
    await setRules("auto_confirm_bookings = true");
    expect((await book(ws, svc, st, null, await berlin(6, "10:00"))).out_status).toBe("confirmed");
    await setRules("auto_confirm_bookings = false");
  });
});

describe("0019 concurrency: the exclusion constraints are the final judge", () => {
  // PGlite runs one session, so the two calls are serialized; what is proven is that the SECOND call
  // is refused by the database itself (23P01), which is exactly what a real race also hits.
  let ws: string, svcRoom: string, svc: string, s1: string, s2: string, r1: string, r2: string;
  beforeAll(async () => {
    ws = (await q<{ id: string }>("insert into workspaces (slug,name,created_by) values ('race-biz','Race',$1) returning id", [OWNER_A]))[0].id;
    await db.exec(`insert into financial_buckets (workspace_id,name,slug,kind,is_default) values ('${ws}','Main','main','main',true)`);
    s1 = await newStaff(ws, "S1");
    s2 = await newStaff(ws, "S2");
    svc = await newService(ws, "Plain");
    svcRoom = await newService(ws, "Room svc", "room");
    r1 = await newRoom(ws, "R1");
    r2 = await newRoom(ws, "R2");
  });

  it("same staff, same slot: the second booking raises 23P01", async () => {
    const t = await berlin(7, "10:00");
    await book(ws, svc, s1, null, t);
    expect(await codeOf(book(ws, svc, s1, null, t))).toBe("23P01");
    expect(await codeOf(book(ws, svc, s1, null, new Date(Date.parse(t) + 10 * 60_000).toISOString()))).toBe("23P01"); // overlapping
  });
  it("same resource, different staff, same slot: the second booking raises 23P01", async () => {
    const t = await berlin(7, "12:00");
    await book(ws, svcRoom, s1, r1, t);
    expect(await codeOf(book(ws, svcRoom, s2, r1, t))).toBe("23P01");
  });
  it("independent staff / resources in parallel succeed", async () => {
    const t = await berlin(7, "15:00");
    const results = await Promise.allSettled([
      book(ws, svc, s1, null, t),
      book(ws, svc, s2, null, t),
      book(ws, svcRoom, s1, r1, await berlin(7, "16:00")),
      book(ws, svcRoom, s2, r2, await berlin(7, "16:00")),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
  });
});

describe("0019 cancel / reschedule deadlines", () => {
  let ws: string, st: string, st2: string, svc: string, svcRoom: string, roomA: string, roomB: string;
  beforeAll(async () => {
    ws = (await q<{ id: string }>("insert into workspaces (slug,name,created_by) values ('dead-biz','Deadlines',$1) returning id", [OWNER_A]))[0].id;
    await db.exec(`insert into financial_buckets (workspace_id,name,slug,kind,is_default) values ('${ws}','Main','main','main',true)`);
    st = await newStaff(ws, "D1");
    st2 = await newStaff(ws, "D2");
    svc = await newService(ws, "Plain");
    svcRoom = await newService(ws, "Room", "room");
    roomA = await newRoom(ws, "RA");
    roomB = await newRoom(ws, "RB");
  });
  const rules = (sql: string) => q(`update workspaces set ${sql} where id=$1`, [ws]);
  const mine = async (startsAt: string, service = svc, staff = st, resource: string | null = null) => {
    const a = await book(ws, service, staff, resource, startsAt);
    await claim(a.out_appointment_id);
    return a.out_appointment_id;
  };

  it("cancel: allowed until the deadline, then not_manageable", async () => {
    await rules("cancellation_deadline_hours = 24");
    const soon = await mine(inHours(5));
    expect(await messageOf(rpc("cancel_my_booking", [CLIENT_1, soon]))).toMatch(/not_manageable/);
    expect(await codeOf(rpc("cancel_my_booking", [CLIENT_1, soon]))).toBe("22023");
    const later = await mine(inHours(24 * 3 + 7));
    expect((await rpc<{ cancel_my_booking: string }>("cancel_my_booking", [CLIENT_1, later]))[0].cancel_my_booking).toBe("cancelled");
    expect((await q<{ status: string }>("select status::text as status from appointments where id=$1", [soon]))[0].status).toBe("pending");
    await rules("cancellation_deadline_hours = 0");
    // Deadline 0: any future booking can be cancelled again.
    expect((await rpc<{ cancel_my_booking: string }>("cancel_my_booking", [CLIENT_1, soon]))[0].cancel_my_booking).toBe("cancelled");
  });

  it("reschedule: deadline, min notice, horizon and linked resource are enforced", async () => {
    await rules("reschedule_deadline_hours = 24");
    const soon = await mine(inHours(6));
    expect(await messageOf(rpc("reschedule_my_booking", [CLIENT_1, soon, inHours(24 * 5), st, null]))).toMatch(/not_manageable/);
    await rules("reschedule_deadline_hours = 0");

    const a = await mine(inHours(24 * 4 + 2), svc, st2);
    await rules("min_notice_minutes = 600");
    expect(await messageOf(rpc("reschedule_my_booking", [CLIENT_1, a, inHours(5), st2, null]))).toMatch(/invalid_time/);
    await rules("min_notice_minutes = 0, max_horizon_days = 10");
    expect(await messageOf(rpc("reschedule_my_booking", [CLIENT_1, a, await berlin(12, "10:00"), st2, null]))).toMatch(/invalid_time/);
    const ok = await rpc<{ out_status: string }>("reschedule_my_booking", [CLIENT_1, a, await berlin(8, "10:00"), st2, null]);
    expect(ok[0].out_status).toBe("pending");
    await rules("max_horizon_days = 90");

    const r = await mine(await berlin(6, "09:00"), svcRoom, st, roomA);
    await q("insert into service_resources (service_id,resource_id) values ($1,$2)", [svcRoom, roomA]);
    expect(await messageOf(rpc("reschedule_my_booking", [CLIENT_1, r, await berlin(6, "11:00"), st, roomB]))).toMatch(/resource_unavailable/);
    const moved = await rpc<{ out_status: string }>("reschedule_my_booking", [CLIENT_1, r, await berlin(6, "11:00"), st, roomA]);
    expect(moved).toHaveLength(1);
  });
});

describe("0019 replay-safety, backfill and existing data (database that stops at 0018)", () => {
  let legacy: PGlite;
  const lq = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await legacy.query<T>(sql, p)).rows;
  const sql0019 = () => readFileSync(path.join(migrationsDir, "0019_staff_scheduling.sql"), "utf8");
  let w: string, custom: string, plain: string, appt: string;

  beforeAll(async () => {
    legacy = new PGlite({ extensions: { pgcrypto, btree_gist }, parsers: { [types.DATE]: (v: string) => v, [types.TIME]: (v: string) => v } });
    await legacy.exec(`
      create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
      create schema auth; create table auth.users (id uuid primary key default gen_random_uuid(), email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;
      grant select on auth.users to service_role;`);
    for (const f of migrationFiles().filter((n) => n < "0019")) await legacy.exec(readFileSync(path.join(migrationsDir, f), "utf8"));
    await legacy.exec(`insert into auth.users (id,email) values ('${OWNER_A}','a@t.invalid')`);
    w = (await lq<{ out_workspace_id: string }>("select * from public.provision_workspace($1,'a@t.invalid','','Old biz','old-biz','en')", [OWNER_A]))[0].out_workspace_id;
    plain = (await lq<{ id: string }>("select id from staff_profiles where workspace_id=$1", [w]))[0].id;
    custom = (await lq<{ id: string }>("insert into staff_profiles (workspace_id,name) values ($1,'Has hours') returning id", [w]))[0].id;
    await lq("insert into working_hours (workspace_id,staff_id,weekday,start_time,end_time) values ($1,$2,1,'10:00','16:00')", [w, custom]);
    const svc = (await lq<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Old',30,20) returning id", [w]))[0].id;
    const bucket = (await lq<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [w]))[0].id;
    appt = (await lq<{ id: string }>(
      "insert into appointments (workspace_id,service_id,staff_id,starts_at,ends_at,financial_bucket_id,status) values ($1,$2,$3, now() + interval '2 days', now() + interval '2 days 30 minutes',$4,'confirmed') returning id",
      [w, svc, plain, bucket])
    )[0].id;
    await legacy.exec(sql0019());
  }, 90_000);
  afterAll(async () => legacy.close());

  it("backfills schedule_mode: custom only for staff that already had working hours", async () => {
    expect((await lq<{ schedule_mode: string }>("select schedule_mode from staff_profiles where id=$1", [custom]))[0].schedule_mode).toBe("custom");
    expect((await lq<{ schedule_mode: string }>("select schedule_mode from staff_profiles where id=$1", [plain]))[0].schedule_mode).toBe("inherit");
  });
  it("leaves existing data untouched and valid", async () => {
    expect(await lq("select status::text as status from appointments where id=$1", [appt])).toEqual([{ status: "confirmed" }]);
    expect(await lq("select count(*)::int as n from working_hours where workspace_id=$1", [w])).toEqual([{ n: 8 }]);
    expect((await lq<{ max_horizon_days: number }>("select max_horizon_days from workspaces where id=$1", [w]))[0].max_horizon_days).toBe(90);
  });
  it("running 0019 again changes nothing (a deliberate 'inherit' is not flipped back)", async () => {
    await lq("update staff_profiles set schedule_mode='inherit' where id=$1", [custom]);
    await lq("update workspaces set min_notice_minutes=45 where id=$1", [w]);
    const before = await lq("select (select count(*)::int from working_hours) wh, (select count(*)::int from staff_profiles) sp, (select count(*)::int from appointments) ap");
    await legacy.exec(sql0019());
    await legacy.exec(sql0019());
    expect(await lq("select (select count(*)::int from working_hours) wh, (select count(*)::int from staff_profiles) sp, (select count(*)::int from appointments) ap")).toEqual(before);
    expect((await lq<{ schedule_mode: string }>("select schedule_mode from staff_profiles where id=$1", [custom]))[0].schedule_mode).toBe("inherit");
    expect((await lq<{ n: number }>("select min_notice_minutes as n from workspaces where id=$1", [w]))[0].n).toBe(45);
  });
  it("the functions and policies exist once after replays", async () => {
    expect(await lq("select count(*)::int as n from pg_policies where tablename in ('time_off','service_resources')")).toEqual([{ n: 8 }]);
    expect(await lq("select count(*)::int as n from pg_trigger where tgname in ('working_hours_integrity','staff_profiles_restrict_delete','resources_restrict_delete','services_restrict_delete','time_off_guard_refs','service_resources_guard_refs')")).toEqual([{ n: 6 }]);
  });
});
