import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

/**
 * Archive / restore on the shared test database (PGlite): roles, workspace
 * isolation, idempotency, the active list / search source, the archive list,
 * history and finance staying intact, audit without personal data.
 */
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const archive = await import("../clientArchive.service");
const clients = await import("../clients.service");
const finance = await import("../finance.service");
const { getServerAppointmentsRepository } = await import("@/server/repository/registry");
const { PermissionDeniedError } = await import("@/server/permissions/roles");
const { RepositoryNotFoundError, RepositoryConflictError, RepositoryClientArchivedError } = await import("@/server/repository/errors");
const appointments = await import("../appointments.service");
const { describeSaveError } = await import("@/lib/repository/describeSaveError");
const { RemoteRepositoryError } = await import("@/lib/repository/createRemoteRepository");
const { getMessages } = await import("@/lib/i18n");
const { toActionError } = await import("@/server/actions/result");

const OWNER = "aaaaaaaa-0000-4000-8000-000000000101";
const ADMIN = "bbbbbbbb-0000-4000-8000-000000000102";
const MANAGER = "cccccccc-0000-4000-8000-000000000103";
const STAFF = "dddddddd-0000-4000-8000-000000000104";
const ACCOUNTANT = "eeeeeeee-0000-4000-8000-000000000105";
const OTHER_OWNER = "ffffffff-0000-4000-8000-000000000106";
let db: PGlite;
let slug: string, otherSlug: string, wsId: string, otherClient: string;
const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const sessionOf = async (id: string, s = slug) => (as(id), getSession(s));

const provision = async (user: string, email: string, base: string) =>
  ((await createPgliteSupabaseClient(db, { kind: "service" }).rpc("provision_workspace", { p_user_id: user, p_email: email, p_full_name: "", p_business_name: "Biz", p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[])[0];

let day = 2;
async function seedClient(name: string) {
  const id = (await q<{ id: string }>("insert into clients (workspace_id,name,email,phone,notes) values ($1,$2,$3,'+49 30 9','private note') returning id", [wsId, name, `${name.toLowerCase()}@t.invalid`]))[0].id;
  const staff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
  const svc = (await q<{ id: string }>("select id from services where workspace_id=$1 limit 1", [wsId]))[0].id;
  const bucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [wsId]))[0].id;
  await q(`insert into appointments (workspace_id, client_id, service_id, staff_id, financial_bucket_id, status, starts_at, ends_at, timezone, price) values
    ($1,$2,$3,$4,$5,'completed', now() - make_interval(days => $6), now() - make_interval(days => $6) + interval '30 minutes', 'Europe/Berlin', 40),
    ($1,$2,$3,$4,$5,'confirmed', now() + make_interval(days => $6), now() + make_interval(days => $6, mins => 30), 'Europe/Berlin', 40)`,
    [wsId, id, svc, staff, bucket, day++]);
  await q("insert into invoices (workspace_id, client_id, client_name, number, status) values ($1,$2,$3,$4,'draft')", [wsId, id, name, `INV-${name}`]);
  return id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),
    ('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid'),('${OTHER_OWNER}','x@t.invalid')`);
  const a = await provision(OWNER, "o@t.invalid", "archive-svc");
  const b = await provision(OTHER_OWNER, "x@t.invalid", "archive-other");
  wsId = a.out_workspace_id;
  slug = a.out_slug;
  otherSlug = b.out_slug;
  await db.exec(`insert into profiles (id,email) values ('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','c@t.invalid');
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${ADMIN}','admin'),('${wsId}','${MANAGER}','manager'),('${wsId}','${STAFF}','staff'),('${wsId}','${ACCOUNTANT}','accountant')`);
  await q("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Cut',30,40)", [wsId]);
  otherClient = (await q<{ id: string }>("insert into clients (workspace_id,name) values ($1,'Other Client') returning id", [b.out_workspace_id]))[0].id;
}, 120_000);

afterAll(async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  await db.close();
});

describe("client archive service", () => {
  it("owner and admin archive and restore; repeating either is a safe no-op", async () => {
    const c = await seedClient("Olga");
    const owner = await sessionOf(OWNER);
    expect(await archive.archiveClient(owner, c)).toMatchObject({ status: "archived" });
    expect(await archive.archiveClient(owner, c)).toMatchObject({ status: "unchanged" });
    expect(await archive.restoreClient(owner, c)).toMatchObject({ status: "restored", archivedAt: null });
    expect(await archive.restoreClient(owner, c)).toMatchObject({ status: "unchanged", archivedAt: null });
    const admin = await sessionOf(ADMIN);
    expect(await archive.archiveClient(admin, c)).toMatchObject({ status: "archived" });
    expect(await archive.restoreClient(admin, c)).toMatchObject({ status: "restored" });
    // One audit entry per real change, none for the no-ops; no personal data.
    const audit = await q<{ summary: string; actor_id: string }>("select summary, actor_id from audit_logs where entity_id=$1 order by created_at", [c]);
    expect(audit.map((a) => a.summary)).toEqual(["Client archived", "Client restored from archive", "Client archived", "Client restored from archive"]);
    expect(audit.map((a) => a.actor_id)).toEqual([OWNER, OWNER, ADMIN, ADMIN]);
    expect(JSON.stringify(audit)).not.toMatch(/Olga|olga@|\+49|private note/);
  });

  it("manager, staff and accountant are refused; nothing changes", async () => {
    const c = await seedClient("Rita");
    for (const id of [MANAGER, STAFF, ACCOUNTANT]) {
      const s = await sessionOf(id);
      await expect(archive.archiveClient(s, c), id).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(archive.listArchivedClients(s), id).rejects.toBeInstanceOf(PermissionDeniedError);
    }
    expect((await q<{ a: string | null }>("select archived_at as a from clients where id=$1", [c]))[0].a).toBeNull();
  });

  it("workspace A cannot archive or restore a client of workspace B", async () => {
    const owner = await sessionOf(OWNER);
    await expect(archive.archiveClient(owner, otherClient)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(archive.restoreClient(owner, otherClient)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect((await q<{ a: string | null }>("select archived_at as a from clients where id=$1", [otherClient]))[0].a).toBeNull();
    // The other workspace's owner cannot touch ours either.
    const c = await seedClient("Vera");
    const other = await sessionOf(OTHER_OWNER, otherSlug);
    await expect(archive.archiveClient(other, c)).rejects.toBeInstanceOf(RepositoryNotFoundError);
  });

  it("active list (also the source of search and pickers) excludes archived clients; the archive lists only archived", async () => {
    const active = await seedClient("Anna");
    const gone = await seedClient("Gone");
    const owner = await sessionOf(OWNER);
    await archive.archiveClient(owner, gone);
    const list = await clients.listClients(owner);
    expect(list.some((c) => c.id === active)).toBe(true);
    expect(list.some((c) => c.id === gone)).toBe(false);
    // Every role's server-side list is filtered (no UI-only filter): staff too.
    expect((await clients.listClients(await sessionOf(STAFF))).some((c) => c.id === gone)).toBe(false);
    const archived = await archive.listArchivedClients(await sessionOf(OWNER));
    expect(archived.map((c) => c.id)).toContain(gone);
    expect(archived.every((c) => c.archivedAt)).toBe(true);
    expect(archived.some((c) => c.id === active)).toBe(false);
    // The card can still open an archived client by id.
    expect((await clients.getClient(await sessionOf(OWNER), gone))?.archivedAt).toBeTruthy();
  });

  it("history, future appointments, invoices and the finance summary stay unchanged", async () => {
    const c = await seedClient("Hist");
    const owner = await sessionOf(OWNER);
    const summaryBefore = await finance.getFinanceSummary(owner);
    const apptsBefore = (await getServerAppointmentsRepository(wsId).list()).filter((a) => a.clientId === c);
    const invoicesBefore = (await finance.listInvoices(owner)).filter((i) => i.clientId === c);
    await archive.archiveClient(owner, c);
    const apptsAfter = (await getServerAppointmentsRepository(wsId).list()).filter((a) => a.clientId === c);
    expect(apptsAfter).toEqual(apptsBefore);
    expect(apptsAfter.map((a) => a.client)).toEqual(["Hist", "Hist"]); // the name stays visible in history
    expect(apptsAfter.some((a) => a.status === "confirmed")).toBe(true); // the future appointment is not cancelled
    expect((await finance.listInvoices(owner)).filter((i) => i.clientId === c)).toEqual(invoicesBefore);
    expect(await finance.getFinanceSummary(owner)).toEqual(summaryBefore);
  });

  it("a new client with the e-mail of an archived client is refused as a duplicate (no second record)", async () => {
    const c = await seedClient("Dora");
    const owner = await sessionOf(OWNER);
    await archive.archiveClient(owner, c);
    const err = await clients
      .createClient(owner, { name: "Dora New", email: "dora@t.invalid", phone: "", notes: "", tags: [] })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryConflictError);
    expect(toActionError(err)).toBe("conflict"); // the UI shows repositoryErrors.clientExists (with the archive hint)
    expect((await q<{ n: number }>("select count(*)::int as n from clients where workspace_id=$1 and lower(email)='dora@t.invalid'", [wsId]))[0].n).toBe(1);
  });

  it("a new appointment for an archived client gives a clear 'restore first' message", async () => {
    const c = await seedClient("Nora");
    const owner = await sessionOf(OWNER);
    await archive.archiveClient(owner, c);
    const staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
    const serviceId = (await q<{ id: string }>("select id from services where workspace_id=$1 limit 1", [wsId]))[0].id;
    const err = await appointments
      .createAppointment(owner, {
        client: "Nora", clientId: c, service: "Cut", serviceId, staff: "You", staffId, resourceId: null,
        date: (() => { const d = new Date(Date.now() + 40 * 86_400_000); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })(), time: "10:00", durationMinutes: 30,
        price: 40, currency: "EUR", notes: "", visibility: "normal", financialBucket: "main", status: "confirmed", paid: false,
      })
      .then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryClientArchivedError);
    expect(toActionError(err)).toBe("client_archived");
    const text = describeSaveError(new RemoteRepositoryError("client_archived"), getMessages("ru").repositoryErrors);
    expect(text).toBe("Клиент в архиве. Восстановите его, чтобы создать новую запись.");
    for (const loc of ["en", "de", "ru", "uk"] as const) expect(getMessages(loc).repositoryErrors.clientArchived.length).toBeGreaterThan(10);
  });
});
