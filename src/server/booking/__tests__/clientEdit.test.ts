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
const clientsService = await import("@/server/services/clients.service");
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

describe("Editing a business-side client", () => {
  const mk = async (name: string, email: string) => {
    as(OWNER);
    return clientsService.createClient(await getSession(slug), { name, email, phone: "", tags: [], notes: "" });
  };

  it("owner updates name, phone, email, notes and the VIP tag", async () => {
    const c = await mk("Anna", "anna@test.invalid");
    const updated = await clientsService.updateClient(await getSession(slug), c.id, {
      name: "Anna K.", phone: "+49 123", email: "anna.k@test.invalid", notes: "Allergic", tags: ["vip"],
    });
    expect(updated).toMatchObject({ name: "Anna K.", phone: "+49 123", email: "anna.k@test.invalid", notes: "Allergic", tags: ["vip"] });
  });

  it("an e-mail already used by another client is a conflict (never a raw error)", async () => {
    const a = await mk("Bob", "bob@test.invalid");
    await mk("Cleo", "cleo@test.invalid");
    await expect(clientsService.updateClient(await getSession(slug), a.id, { email: "CLEO@test.invalid" })).rejects.toMatchObject({ name: "RepositoryConflictError" });
  });

  it("an invalid e-mail is rejected by validation", async () => {
    const a = await mk("Dan", "dan@test.invalid");
    await expect(clientsService.updateClient(await getSession(slug), a.id, { email: "not-an-email" })).rejects.toThrow();
  });

  it("staff role cannot edit clients", async () => {
    const a = await mk("Eve", "eve@test.invalid");
    as(STAFF);
    await expect(clientsService.updateClient(await getSession(slug), a.id, { name: "Hacked" })).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("another workspace's owner cannot read or edit this client (tenant isolation)", async () => {
    const a = await mk("Fay", "fay@test.invalid");
    as(OTHER);
    await expect(getSession(slug)).rejects.toThrow();
    const otherSession = await getSession(otherSlug);
    expect(await clientsService.updateClient(otherSession, a.id, { name: "Hacked" })).toBeUndefined();
    as(OWNER);
    expect((await clientsService.getClient(await getSession(slug), a.id))?.name).toBe("Fay");
  });
});
