import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

/**
 * POST /api/workspaces/[slug]/clients/[id]/export end to end: real session,
 * service and database (PGlite, synthetic data). Checks headers, same-origin
 * guard, role checks, workspace isolation, the DSR register and that nothing
 * personal reaches the logs.
 */
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { POST } = await import("@/app/api/workspaces/[workspaceSlug]/clients/[clientId]/export/route");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000b1";
const ADMIN = "bbbbbbbb-0000-4000-8000-0000000000b2";
const MANAGER = "cccccccc-0000-4000-8000-0000000000b3";
const OTHER_OWNER = "dddddddd-0000-4000-8000-0000000000b4";

let db: PGlite;
let slug: string, otherSlug: string, wsId: string, client: string, otherClient: string;
const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const service = () => createPgliteSupabaseClient(db, { kind: "service" });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

function post(workspace: string, id: string, body: unknown, headers: Record<string, string> = {}) {
  const url = `https://app.test/api/workspaces/${workspace}/clients/${id}/export`;
  const request = new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.test", ...headers },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ workspaceSlug: workspace, clientId: id }) });
}

const provision = async (user: string, email: string, base: string) =>
  ((await service().rpc("provision_workspace", { p_user_id: user, p_email: email, p_full_name: "", p_business_name: "Biz", p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[])[0];

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),('${OTHER_OWNER}','x@t.invalid')`);
  const a = await provision(OWNER, "o@t.invalid", "route-export-a");
  const b = await provision(OTHER_OWNER, "x@t.invalid", "route-export-b");
  wsId = a.out_workspace_id;
  slug = a.out_slug;
  otherSlug = b.out_slug;
  await db.exec(`insert into profiles (id,email) values ('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid');
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${ADMIN}','admin'),('${wsId}','${MANAGER}','manager')`);
  client = (await q<{ id: string }>("insert into clients (workspace_id,name,email,phone) values ($1,'Dana Route','dana@t.invalid','+49 1') returning id", [wsId]))[0].id;
  otherClient = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Eve Other','eve@t.invalid') returning id", [b.out_workspace_id]))[0].id;
}, 120_000);

afterAll(async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  await db.close();
});

describe("client export route", () => {
  it("owner: JSON attachment, never cached, no public link", async () => {
    as(OWNER);
    const res = await post(slug, client, { mode: "admin" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(res.headers.get("pragma")).toBe("no-cache");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="client-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(res.headers.get("content-disposition")).not.toContain("Dana");
    expect(res.headers.get("location")).toBeNull();
    const body = await res.json();
    expect(body.profile).toMatchObject({ name: "Dana Route", email: "dana@t.invalid" });
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//); // no link to a stored copy
  });

  it("admin may export; manager gets 403; internal notes are owner-only", async () => {
    as(ADMIN);
    expect((await post(slug, client, { mode: "admin" })).status).toBe(200);
    expect((await post(slug, client, { mode: "admin", includeInternalNotes: true })).status).toBe(403);
    as(MANAGER);
    const res = await post(slug, client, { mode: "admin" });
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("another workspace's client is a plain 404; another workspace's slug is refused", async () => {
    as(OWNER);
    expect((await post(slug, otherClient, { mode: "admin" })).status).toBe(404);
    expect((await post(slug, "00000000-0000-4000-8000-000000000000", { mode: "admin" })).status).toBe(404);
    expect((await post(otherSlug, otherClient, { mode: "admin" })).status).toBe(403);
  });

  it("cross-site and non-JSON requests are refused before any data access", async () => {
    as(OWNER);
    expect((await post(slug, client, { mode: "admin" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(slug, client, { mode: "admin" }, { "content-type": "text/plain" })).status).toBe(403);
    expect((await post("demo-salon", client, { mode: "admin" })).status).toBe(404);
  });

  it("DSR mode: identity must be confirmed; the register stores metadata only", async () => {
    as(OWNER);
    const request = { type: "access", receivedOn: "2026-11-01", dueOn: "2026-12-01" };
    expect((await post(slug, client, { mode: "data_subject_request", request: { ...request, identityVerified: false } })).status).toBe(400);
    const res = await post(slug, client, { mode: "data_subject_request", request: { ...request, identityVerified: true } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dataSubjectRequest).toMatchObject({ status: "draft", purposes: "Needs legal review", type: "access", identityVerified: true });
    const [row] = await q<Record<string, unknown>>("select * from data_subject_requests where client_id=$1", [client]);
    expect(row).toMatchObject({ request_type: "access", status: "completed", identity_verified: true, responsible_profile_id: OWNER, created_by: OWNER });
    expect(JSON.stringify(row)).not.toMatch(/Dana|dana@|\+49/);
  });

  it("logs nothing personal; invalid input is a 400", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    as(OWNER);
    expect((await post(slug, client, { mode: "everything" })).status).toBe(400);
    await post(slug, client, { mode: "admin" });
    const logged = JSON.stringify([...spy.mock.calls, ...log.mock.calls]);
    expect(logged).not.toMatch(/Dana|dana@|\+49/);
    spy.mockRestore();
    log.mockRestore();
  });

  it("static: no Storage upload, no public URL, no content logging in the export path", () => {
    const root = path.resolve(__dirname, "../../../..");
    for (const file of ["src/app/api/workspaces/[workspaceSlug]/clients/[clientId]/export/route.ts", "src/server/services/clientExport.service.ts"]) {
      const src = readFileSync(path.join(root, file), "utf8");
      expect(src, file).not.toMatch(/\.storage\b|createSignedUrl|getPublicUrl|console\.log/);
    }
  });
});
