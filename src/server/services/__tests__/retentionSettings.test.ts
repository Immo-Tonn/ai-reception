import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

/**
 * Retention settings service on the real database (PGlite): owner saves and
 * reads back, admin reads only, other roles are refused, values are validated on
 * the server, and saving changes nothing else.
 */
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const service = await import("../retentionSettings.service");
const { PermissionDeniedError } = await import("@/server/permissions/roles");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000e1";
const ADMIN = "bbbbbbbb-0000-4000-8000-0000000000e2";
const MANAGER = "cccccccc-0000-4000-8000-0000000000e3";
let db: PGlite;
let slug: string, wsId: string;
const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid')`);
  const r = (await createPgliteSupabaseClient(db, { kind: "service" }).rpc("provision_workspace", { p_user_id: OWNER, p_email: "o@t.invalid", p_full_name: "", p_business_name: "Biz", p_base_slug: "keep-svc", p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[];
  wsId = r[0].out_workspace_id;
  slug = r[0].out_slug;
  await db.exec(`insert into profiles (id,email) values ('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid');
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${ADMIN}','admin'),('${wsId}','${MANAGER}','manager')`);
}, 90_000);

afterAll(async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  await db.close();
});

describe("retention settings service", () => {
  it("default 36; the owner saves 48 and reads it back; automatic anonymisation stays off", async () => {
    as(OWNER);
    const session = await getSession(slug);
    expect(await service.getRetentionSettings(session)).toMatchObject({ clientRetentionMonths: 36, recommendedMonths: 36, canEdit: true, autoAnonymizeActive: false });
    const before = await q<{ s: string }>("select md5(string_agg(to_jsonb(t)::text, '')) as s from (select * from clients union all select * from clients) t");
    expect(await service.updateClientRetentionMonths(session, 48)).toMatchObject({ clientRetentionMonths: 48, autoAnonymizeActive: false });
    expect((await service.getRetentionSettings(session)).clientRetentionMonths).toBe(48);
    expect(await q("select md5(string_agg(to_jsonb(t)::text, '')) as s from (select * from clients union all select * from clients) t")).toEqual(before);
    const [audit] = await q<{ summary: string }>("select summary from audit_logs where workspace_id=$1 and entity_type='workspace' order by created_at desc limit 1", [wsId]);
    expect(audit.summary).toBe("Client data retention period set to 48 months");
  });

  it("rejects invalid values on the server before the database", async () => {
    as(OWNER);
    const session = await getSession(slug);
    for (const bad of [0, -1, 11, 121, 12.5, Number.NaN]) {
      await expect(service.updateClientRetentionMonths(session, bad), String(bad)).rejects.toBeInstanceOf(ZodError);
    }
    expect((await service.getRetentionSettings(session)).clientRetentionMonths).toBe(48);
  });

  it("admin reads (canEdit false) but cannot change; manager can neither read nor change", async () => {
    as(ADMIN);
    const admin = await getSession(slug);
    expect(await service.getRetentionSettings(admin)).toMatchObject({ clientRetentionMonths: 48, canEdit: false });
    await expect(service.updateClientRetentionMonths(admin, 24)).rejects.toBeInstanceOf(PermissionDeniedError);
    as(MANAGER);
    const manager = await getSession(slug);
    await expect(service.getRetentionSettings(manager)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(service.updateClientRetentionMonths(manager, 24)).rejects.toBeInstanceOf(PermissionDeniedError);
    expect((await q<{ m: number }>("select client_retention_months as m from workspaces where id=$1", [wsId]))[0].m).toBe(48);
  });
});
