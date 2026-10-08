import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { as, createMigratedDb, migrationsDir } from "./pg";

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const STAFF = "dddddddd-0000-4000-8000-0000000000d4";
const OTHER = "eeeeeeee-0000-4000-8000-0000000000e5";

let db: PGlite;
let wsA: string;
let slugA: string;
let wsB: string;
let slugB: string;
let svcA: string;
let staffA: string;

const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const rpc = async <T>(fn: string, args: unknown[], actor: Parameters<typeof as>[1]) =>
  as(db, actor, async () => (await db.query<T>(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")})`, args)).rows);

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${STAFF}','s@t.invalid'),('${OTHER}','x@t.invalid')`);
  const prov = async (u: string, e: string, n: string, b: string) =>
    (await as(db, { kind: "service" }, async () =>
      (await db.query<{ out_workspace_id: string; out_slug: string }>("select * from public.provision_workspace($1,$2,'',$3,$4,'en')", [u, e, n, b])).rows))[0];
  const a = await prov(OWNER, "o@t.invalid", "Biz A", "biz-a");
  const b = await prov(OTHER, "x@t.invalid", "Biz B", "biz-b");
  wsA = a.out_workspace_id; slugA = a.out_slug; wsB = b.out_workspace_id; slugB = b.out_slug;
  await db.exec(`insert into profiles (id,email) values ('${STAFF}','s@t.invalid') on conflict do nothing;
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsA}','${STAFF}','staff')`);
  svcA = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price,description) values ($1,'Cut',30,40,'Nice cut') returning id", [wsA]))[0].id;
  staffA = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsA]))[0].id;
}, 90_000);

afterAll(async () => db.close());

describe("0017 defaults", () => {
  it("a new workspace is bookable by link but never discoverable", async () => {
    expect(await q("select public_booking_enabled, discoverable, description, logo_path from workspaces where id=$1", [wsA]))
      .toEqual([{ public_booking_enabled: true, discoverable: false, description: "", logo_path: null }]);
  });
  it("is replay-safe: running 0017 again changes nothing", async () => {
    const before = await q("select * from workspaces order by id");
    await db.exec(readFileSync(path.join(migrationsDir, "0017_business_profile_and_discovery.sql"), "utf8"));
    expect(await q("select * from workspaces order by id")).toEqual(before);
  });
});

describe("0017 constraints", () => {
  const bad = async (set: string) => expect(db.exec(`update workspaces set ${set} where id='${wsA}'`)).rejects.toThrow();
  it("rejects malformed profile values", async () => {
    await bad("email='nope'");
    await bad("website='javascript:alert(1)'");
    await bad("country='Germany'");
    await bad("logo_path='https://evil.invalid/x.png'");
    await bad("logo_path='../../etc/passwd'");
    await bad(`description='${"x".repeat(1001)}'`);
  });
  it("accepts a good profile and a workspace-scoped logo reference", async () => {
    await db.exec(`update workspaces set email='hi@biz.example', website='https://biz.example', country='DE', phone='+49 1',
      city='Berlin', logo_path='${wsA}/logo.png' where id='${wsA}'`);
  });
  it("discoverable requires public booking, but booking does not require discoverable", async () => {
    await expect(db.exec(`update workspaces set public_booking_enabled=false, discoverable=true where id='${wsA}'`)).rejects.toThrow();
    await db.exec(`update workspaces set discoverable=false where id='${wsA}'`);
  });
});

describe("0017 who can change it (RLS)", () => {
  it("owner can; staff and other tenants cannot; slug stays immutable", async () => {
    await as(db, { kind: "user", id: OWNER }, () => db.exec(`update workspaces set name='Renamed', description='d' where id='${wsA}'`));
    expect((await q<{ slug: string; name: string }>("select slug,name from workspaces where id=$1", [wsA]))[0]).toEqual({ slug: slugA, name: "Renamed" });

    for (const id of [STAFF, OTHER]) {
      await as(db, { kind: "user", id }, () => db.exec(`update workspaces set description='hacked', discoverable=true where id='${wsA}'`));
    }
    expect((await q<{ description: string; discoverable: boolean }>("select description,discoverable from workspaces where id=$1", [wsA]))[0]).toEqual({ description: "d", discoverable: false });

    await expect(as(db, { kind: "user", id: OWNER }, () => db.exec(`update workspaces set slug='new-slug' where id='${wsA}'`))).rejects.toThrow();
  });
  it("anon reads nothing from workspaces; other tenants see only their own row", async () => {
    await expect(as(db, { kind: "anon" }, () => db.query("select * from workspaces"))).rejects.toThrow();
    const rows = await as(db, { kind: "user", id: OTHER }, async () => (await db.query<{ id: string }>("select id from workspaces")).rows);
    expect(rows).toEqual([{ id: wsB }]);
  });
});

describe("0017 public boundary", () => {
  it("public RPCs are service-role only", async () => {
    for (const actor of [{ kind: "anon" }, { kind: "user", id: OWNER }] as const) {
      await expect(rpc("get_public_booking_catalog", [slugA], actor)).rejects.toThrow();
      await expect(rpc("list_discoverable_businesses", [10, 0], actor)).rejects.toThrow();
    }
  });
  it("catalog exposes the public profile only, never internal columns", async () => {
    const [{ get_public_booking_catalog: c }] = await rpc<{ get_public_booking_catalog: Record<string, Record<string, unknown>> }>("get_public_booking_catalog", [slugA], { kind: "service" });
    expect(Object.keys(c.profile).sort()).toEqual(["addressLine1", "city", "country", "description", "email", "logoPath", "phone", "postalCode", "website"]);
    expect(Object.keys(c.workspace).sort()).toEqual(["autoConfirm", "id", "name", "slug", "timezone"]);
    expect(JSON.stringify(c)).not.toMatch(/created_by|default_currency|booking_mode/);
    expect((c.services as unknown as { description: string }[])[0].description).toBe("Nice cut");
  });
  it("switching public booking off closes the catalog, busy times and booking, with the same answer as an unknown slug", async () => {
    await db.exec(`update workspaces set public_booking_enabled=false where id='${wsA}'`);
    const svc = { kind: "service" } as const;
    expect((await rpc<{ get_public_booking_catalog: unknown }>("get_public_booking_catalog", [slugA], svc))[0].get_public_booking_catalog).toBeNull();
    expect((await rpc<{ get_public_booking_catalog: unknown }>("get_public_booking_catalog", ["no-such-biz"], svc))[0].get_public_booking_catalog).toBeNull();
    expect(await rpc("get_public_busy", [wsA, "2030-01-01T00:00:00Z", "2030-01-02T00:00:00Z"], svc)).toEqual([]);
    await expect(
      rpc("create_public_booking", [wsA, svcA, staffA, null, new Date(Date.now() + 5 * 86400000).toISOString(), "G", "g@x.invalid", "", ""], svc),
    ).rejects.toThrow(/not_found/);
    await db.exec(`update workspaces set public_booking_enabled=true where id='${wsA}'`);
  });
  it("directory lists only workspaces that opted in, with public fields only", async () => {
    const svc = { kind: "service" } as const;
    expect(await rpc("list_discoverable_businesses", [24, 0], svc)).toEqual([]);
    await db.exec(`update workspaces set discoverable=true where id='${wsA}'`);
    const rows = await rpc<Record<string, unknown>>("list_discoverable_businesses", [24, 0], svc);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).sort()).toEqual(["city", "country", "description", "industry", "logo_path", "name", "slug"]);
    await db.exec(`update workspaces set public_booking_enabled=false, discoverable=false where id='${wsA}'`);
    expect(await rpc("list_discoverable_businesses", [24, 0], svc)).toEqual([]);
    await db.exec(`update workspaces set public_booking_enabled=true where id='${wsA}'`);
  });
  it("existing data is untouched by 0017", async () => {
    expect((await q("select count(*)::int as n from services where workspace_id=$1", [wsA]))[0]).toEqual({ n: 1 });
  });
});
