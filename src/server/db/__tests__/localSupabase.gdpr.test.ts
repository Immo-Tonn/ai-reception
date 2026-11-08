import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { writeAuditEntry, type AuditWriterDeps } from "@/server/audit/auditWriter";

/**
 * Privileges and real API behaviour on a REAL Supabase stack (PostgREST, GoTrue,
 * real JWTs and Supabase's default privileges). PGlite cannot show these: it has no
 * default grants, so a missing REVOKE looks fine there. SKIPPED unless a LOCAL
 * Supabase is running — a skipped run is not a pass.
 *
 * Run (local Docker stack only, synthetic data; never a cloud project):
 *   supabase start            # in a copy of the repo with a throwaway project_id
 *   LOCAL_SUPABASE_API_URL=http://127.0.0.1:54321 \
 *   LOCAL_SUPABASE_ANON_KEY=… LOCAL_SUPABASE_SERVICE_KEY=… \
 *   LOCAL_SUPABASE_DB_CONTAINER=supabase_db_<project_id> \
 *   npx vitest run src/server/db/__tests__/localSupabase.gdpr.test.ts
 * The keys come from `supabase status -o json` of that local stack.
 */
const API = process.env.LOCAL_SUPABASE_API_URL ?? "";
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY ?? "";
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_KEY ?? "";
const DB = process.env.LOCAL_SUPABASE_DB_CONTAINER ?? "";
const enabled = Boolean(API && ANON && SERVICE && DB);
if (enabled && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API)) throw new Error("LOCAL_SUPABASE_API_URL must be a local address");
if (enabled && !/^supabase_db_[A-Za-z0-9_-]+$/.test(DB)) throw new Error("LOCAL_SUPABASE_DB_CONTAINER must be a local Supabase database container");

const psql = (query: string) => execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", query], { encoding: "utf8" }).trim();
const privileges = (role: string, table: string) => {
  // one docker exec per call (a call per privilege is slow on a busy machine)
  const list = ["select", "insert", "update", "delete", "truncate", "references", "trigger"];
  const flags = psql(`select ${list.map((p) => `has_table_privilege('${role}','public.${table}','${p}')`).join(" || ',' || ")}`).split(",");
  return list.filter((_, i) => flags[i] === "true");
};

type Json = Record<string, unknown> & { id?: string; out_workspace_id?: string; request?: unknown };

async function api(path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: init.token === SERVICE ? SERVICE : ANON, Authorization: `Bearer ${init.token ?? ANON}`, "Content-Type": "application/json", Prefer: "return=representation", ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json: parsed as Json & Json[], text };
}

describe.skipIf(!enabled)(`GDPR privileges on a real local Supabase${enabled ? "" : " — SKIPPED (no LOCAL_SUPABASE_* environment)"}`, { timeout: 60_000 }, () => {
  it("data_subject_requests: authenticated may only select, insert and update; anon nothing", () => {
    expect(privileges("authenticated", "data_subject_requests")).toEqual(["select", "insert", "update"]);
    expect(privileges("anon", "data_subject_requests")).toEqual([]);
  });

  it("client_erasure_ledger is closed to anon and authenticated", () => {
    expect(privileges("authenticated", "client_erasure_ledger")).toEqual([]);
    expect(privileges("anon", "client_erasure_ledger")).toEqual([]);
  });

  it("through the real API: the allowed steps work, a request can never be deleted", async () => {
    const stamp = Date.now();
    const account = async (name: string) => {
      const email = `${name}${stamp}@example.com`;
      const created = await api("/auth/v1/admin/users", { method: "POST", token: SERVICE, body: { email, password: "Local-check-pass-1", email_confirm: true } });
      const session = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Local-check-pass-1" }) })).json();
      return { id: created.json.id as string, email, jwt: session.access_token as string };
    };
    const owner = await account("owner");
    const prov = await api("/rest/v1/rpc/provision_workspace", { method: "POST", token: SERVICE, body: { p_user_id: owner.id, p_email: owner.email, p_full_name: "", p_business_name: "Biz", p_base_slug: `priv-${stamp}`, p_locale: "en" } });
    const ws = prov.json[0].out_workspace_id as string;
    const client = (await api("/rest/v1/clients", { method: "POST", token: SERVICE, body: { workspace_id: ws, name: "Synthetic", email: `s${stamp}@example.com` } })).json[0].id as string;

    const created = await api("/rest/v1/data_subject_requests", { method: "POST", token: owner.jwt, body: { workspace_id: ws, client_id: client, request_type: "access", received_on: "2026-03-01", due_on: "2026-04-01", identity_verified: true, created_by: owner.id } });
    expect(created.status).toBe(201);
    const id = created.json[0].id as string;
    expect((await api(`/rest/v1/data_subject_requests?id=eq.${id}`, { method: "PATCH", token: owner.jwt, body: { status: "in_progress" } })).status).toBe(200);
    expect((await api(`/rest/v1/data_subject_requests?id=eq.${id}&select=status`, { token: owner.jwt })).json).toEqual([{ status: "in_progress" }]);
    expect((await api(`/rest/v1/data_subject_requests?id=eq.${id}`, { method: "PATCH", token: owner.jwt, body: { status: "closed", closure_reason: "rejected" } })).status).toBe(200);
    const reopened = await api("/rest/v1/rpc/reopen_data_subject_request", { method: "POST", token: owner.jwt, body: { p_workspace_id: ws, p_request_id: id, p_reason: "closed_by_mistake" } });
    expect(reopened.json).toMatchObject({ status: "in_progress", reopenCount: 1 });
    const exported = await api("/rest/v1/rpc/export_client_data", { method: "POST", token: owner.jwt, body: { p_workspace_id: ws, p_client_id: client, p_mode: "data_subject_request", p_request: { requestId: id } } });
    expect(exported.json?.request).toMatchObject({ id, status: "export_generated" });

    const del = await api(`/rest/v1/data_subject_requests?id=eq.${id}`, { method: "DELETE", token: owner.jwt });
    expect(del.status).toBeGreaterThanOrEqual(400); // permission denied, not just "0 rows"
    expect(psql(`select count(*) from public.data_subject_requests where id='${id}'`)).toBe("1");
  });
});

describe.skipIf(!enabled)(`audit_logs protection (0033) on a real local Supabase${enabled ? "" : " — SKIPPED (no LOCAL_SUPABASE_* environment)"}`, { timeout: 60_000 }, () => {
  it("privileges: authenticated may only read, anon nothing, the service role only insert", () => {
    expect(privileges("authenticated", "audit_logs")).toEqual(["select"]);
    expect(privileges("anon", "audit_logs")).toEqual([]);
    expect(privileges("service_role", "audit_logs")).toEqual(["insert"]);
  });

  it("through the real API: forged entries are refused; the server writer (real Auth + membership + service insert) works", async () => {
    const stamp = Date.now();
    const account = async (name: string) => {
      const email = `${name}${stamp}@example.com`;
      const created = await api("/auth/v1/admin/users", { method: "POST", token: SERVICE, body: { email, password: "Local-check-pass-1", email_confirm: true } });
      const session = await (await fetch(`${API}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Local-check-pass-1" }) })).json();
      return { id: created.json.id as string, email, jwt: session.access_token as string };
    };
    const owner = await account("auditowner");
    const outsider = await account("auditoutsider");
    const prov = await api("/rest/v1/rpc/provision_workspace", { method: "POST", token: SERVICE, body: { p_user_id: owner.id, p_email: owner.email, p_full_name: "", p_business_name: "Biz", p_base_slug: `aud-${stamp}`, p_locale: "en" } });
    const ws = prov.json[0].out_workspace_id as string;
    const entry = (id: string) => ({ workspace_id: ws, actor_id: owner.id, action: "deleted", entity_type: "client", entity_id: id, summary: "forged", source: "user" });
    const count = (id: string) => psql(`select count(*) from audit_logs where entity_id='${id}'`);

    const forged = await api("/rest/v1/audit_logs", { method: "POST", token: owner.jwt, body: entry(`forged-${stamp}`), headers: { Prefer: "return=minimal" } });
    expect(forged.status).toBe(403);
    expect(count(`forged-${stamp}`)).toBe("0");

    // The production deps use the same three calls: identity from the auth server, membership with the user's JWT, insert with the service role.
    const depsFor = (jwt: string): AuditWriterDeps => ({
      async getUserId() {
        const r = await fetch(`${API}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jwt}` } });
        return r.ok ? ((await r.json()) as { id: string }).id : null;
      },
      async isWorkspaceMember(w, u) {
        const r = await api(`/rest/v1/workspace_members?select=profile_id&workspace_id=eq.${w}&profile_id=eq.${u}`, { token: jwt });
        return Array.isArray(r.json) && r.json.length === 1;
      },
      async insert(row) {
        const r = await api("/rest/v1/audit_logs", { method: "POST", token: SERVICE, body: row, headers: { Prefer: "return=minimal" } });
        return r.status === 201 ? null : { code: String(r.status) };
      },
    });
    await writeAuditEntry({ workspaceId: ws, action: "created", entityType: "client", entityId: `ok-${stamp}`, summary: "Created" }, depsFor(owner.jwt));
    expect(psql(`select actor_id||'|'||source from audit_logs where entity_id='ok-${stamp}'`)).toBe(`${owner.id}|user`);

    await expect(writeAuditEntry({ workspaceId: ws, action: "created", entityType: "client", entityId: `out-${stamp}`, summary: "x" }, depsFor(outsider.jwt))).rejects.toMatchObject({ code: "not_a_member" });
    expect(count(`out-${stamp}`)).toBe("0");
  });
});
