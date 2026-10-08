import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

vi.mock("server-only", () => ({}));
const { listDiscoverableBusinesses, clampDiscoveryPaging, mapDiscoverableRow } = await import("../discovery.service");
const { demoWorkspaces } = await import("@/features/workspace/registry");

const U1 = "aaaaaaaa-0000-4000-8000-0000000000a1";
const U2 = "aaaaaaaa-0000-4000-8000-0000000000a2";
const U3 = "aaaaaaaa-0000-4000-8000-0000000000a3";
let db: PGlite;
const admin = () => createPgliteSupabaseClient(db, { kind: "service" });

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${U1}','1@t.invalid'),('${U2}','2@t.invalid'),('${U3}','3@t.invalid')`);
  const prov = async (u: string, n: string, slug: string) =>
    (await admin().rpc("provision_workspace", { p_user_id: u, p_email: `${slug}@t.invalid`, p_full_name: "", p_business_name: n, p_base_slug: slug, p_locale: "en" })).data as { out_slug: string }[];
  await prov(U1, "Listed Salon", "listed-salon");
  await prov(U2, "Hidden Salon", "hidden-salon");
  await prov(U3, "Closed Salon", "closed-salon");
  await db.exec(`update workspaces set discoverable=true, city='Berlin', country='DE', description='Nice', logo_path=id||'/logo.png' where slug='listed-salon';
    update workspaces set public_booking_enabled=false, discoverable=false where slug='closed-salon'`);
}, 90_000);
afterAll(async () => db.close());

describe("client discovery", () => {
  it("lists only opted-in businesses, as a public DTO without internal fields", async () => {
    const list = await listDiscoverableBusinesses({ admin: admin() });
    expect(list).toEqual([{ slug: "listed-salon", name: "Listed Salon", city: "Berlin", country: "DE", description: "Nice" }]);
    expect(Object.keys(list[0]).sort()).toEqual(["city", "country", "description", "name", "slug"]);
  });
  it("never contains demo slugs", async () => {
    await db.exec("update workspaces set discoverable=true where slug='hidden-salon'");
    const slugs = (await listDiscoverableBusinesses({ admin: admin() })).map((b) => b.slug);
    expect(slugs).toEqual(["hidden-salon", "listed-salon"]);
    for (const w of demoWorkspaces) expect(slugs).not.toContain(w.slug);
    await db.exec("update workspaces set discoverable=false where slug='hidden-salon'");
  });
  it("clamps limit and offset", async () => {
    expect(clampDiscoveryPaging(0, -5)).toEqual({ limit: 1, offset: 0 });
    expect(clampDiscoveryPaging(9999, 3.9)).toEqual({ limit: 50, offset: 3 });
    expect(clampDiscoveryPaging(NaN, undefined)).toEqual({ limit: 24, offset: 0 });
    expect(await listDiscoverableBusinesses({ admin: admin() }, { offset: 5 })).toEqual([]);
  });
  it("returns an empty list when the RPC fails or throws", async () => {
    const bad = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    const boom = { rpc: async () => { throw new Error("down"); } };
    expect(await listDiscoverableBusinesses({ admin: bad as never })).toEqual([]);
    expect(await listDiscoverableBusinesses({ admin: boom as never })).toEqual([]);
    expect(mapDiscoverableRow({ slug: "", name: "x" })).toBeNull();
  });
});
