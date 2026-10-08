import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

// The business services/registry/repositories all call createSupabaseServerClient();
// point it at a real Postgres, acting as whichever user the test selects.
let current: SupabaseClient;
// `getSession` treats an unconfigured Supabase as "no real workspaces"; mark it configured (values unused: the client is the test double).
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const bp = await import("@/server/services/businessProfile.service");
const { PermissionDeniedError } = await import("@/server/permissions/roles");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const MANAGER = "cccccccc-0000-4000-8000-0000000000c3";
const STAFF = "dddddddd-0000-4000-8000-0000000000d4";

let db: PGlite;
let slug: string;
let wsId: string;

const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const service = () => createPgliteSupabaseClient(db, { kind: "service" });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;


const OTHER = "eeeeeeee-0000-4000-8000-0000000000e5";
let otherSlug: string;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@test.invalid'),('${MANAGER}','m@test.invalid'),('${STAFF}','s@test.invalid'),('${OTHER}','x@test.invalid')`);
  const prov = async (user: string, email: string, name: string, base: string) =>
    ((await service().rpc("provision_workspace", { p_user_id: user, p_email: email, p_full_name: "", p_business_name: name, p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[])[0];
  const a = await prov(OWNER, "o@test.invalid", "Biz", "biz-salon");
  wsId = a.out_workspace_id;
  slug = a.out_slug;
  otherSlug = (await prov(OTHER, "x@test.invalid", "Other", "other-salon")).out_slug;
  await db.exec(`insert into profiles (id,email) values ('${MANAGER}','m@test.invalid'),('${STAFF}','s@test.invalid');
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${MANAGER}','manager'),('${wsId}','${STAFF}','staff')`);
}, 90_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

const full = {
  name: "Biz", industry: "beauty", description: "", phone: "", email: "", website: "", addressLine1: "", postalCode: "", city: "",
  country: "", timezone: "Europe/Berlin", currency: "EUR" as const, publicBookingEnabled: true, discoverable: false,
};

describe("Business profile editing", () => {
  it("owner renames the business; the slug does not change", async () => {
    as(OWNER);
    const session = await getSession(slug);
    const updated = await bp.updateBusinessProfile(session, { ...full, name: "Labrity Studio", industry: "beauty", timezone: "Europe/Kyiv", currency: "UAH" });
    expect(updated).toMatchObject({ name: "Labrity Studio", industry: "beauty", timezone: "Europe/Kyiv", currency: "UAH" });
    expect(await q("select slug from workspaces where id=$1", [wsId])).toEqual([{ slug }]);
    expect((await bp.getBusinessProfile(session)).name).toBe("Labrity Studio");
  });

  it("rejects an empty name, a bogus time zone and an unknown currency", async () => {
    as(OWNER);
    const session = await getSession(slug);
    const ok = { ...full, name: "X" };
    await expect(bp.updateBusinessProfile(session, { ...ok, name: "  " })).rejects.toThrow();
    await expect(bp.updateBusinessProfile(session, { ...ok, timezone: "Mars/Olympus" })).rejects.toThrow();
    await expect(bp.updateBusinessProfile(session, { ...ok, currency: "XXX" as "EUR" })).rejects.toThrow();
  });

  it("saves contact, address, website normalisation and the two switches independently", async () => {
    as(OWNER);
    const session = await getSession(slug);
    const a = await bp.updateBusinessProfile(session, {
      ...full, description: "Hello", phone: "+49 1", email: "hi@biz.example", website: "biz.example",
      addressLine1: "Main St 1", postalCode: "10115", city: "Berlin", country: "de", publicBookingEnabled: true, discoverable: true,
    });
    expect(a).toMatchObject({ website: "https://biz.example", country: "DE", publicBookingEnabled: true, discoverable: true });
    const b = await bp.updateBusinessProfile(session, { ...a, discoverable: false });
    expect(b).toMatchObject({ publicBookingEnabled: true, discoverable: false });
  });

  it("closing public booking also withdraws the directory listing", async () => {
    as(OWNER);
    const session = await getSession(slug);
    const r = await bp.updateBusinessProfile(session, { ...full, publicBookingEnabled: false, discoverable: true });
    expect(r).toMatchObject({ publicBookingEnabled: false, discoverable: false });
    expect(await q("select public_booking_enabled, discoverable from workspaces where id=$1", [wsId])).toEqual([{ public_booking_enabled: false, discoverable: false }]);
    await bp.updateBusinessProfile(session, { ...full });
  });

  it("rejects an invalid e-mail, website and country", async () => {
    as(OWNER);
    const session = await getSession(slug);
    await expect(bp.updateBusinessProfile(session, { ...full, email: "nope" })).rejects.toThrow();
    await expect(bp.updateBusinessProfile(session, { ...full, website: "javascript:alert(1)" })).rejects.toThrow();
    await expect(bp.updateBusinessProfile(session, { ...full, country: "Germany" })).rejects.toThrow();
  });

  it("staff and manager cannot edit the business profile", async () => {
    for (const id of [STAFF, MANAGER]) {
      as(id);
      await expect(bp.updateBusinessProfile(await getSession(slug), { ...full, name: "Hacked" })).rejects.toBeInstanceOf(PermissionDeniedError);
    }
  });

  it("another workspace's owner cannot rename this business", async () => {
    as(OTHER);
    await expect(getSession(slug)).rejects.toThrow();
    // Even a forged session for this workspace is stopped by Row Level Security.
    await expect(bp.updateBusinessProfile({ userId: OTHER, workspaceId: wsId, role: "owner" }, { ...full, name: "Hacked" })).rejects.toThrow();
    expect((await q<{ name: string }>("select name from workspaces where id=$1", [wsId]))[0].name).not.toBe("Hacked");
  });
});
