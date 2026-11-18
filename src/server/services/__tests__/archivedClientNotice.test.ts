import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { createMemoryRateLimiter } from "@/server/ratelimit/memoryRateLimiter";

/**
 * "Client in the archive" in the calendar and Inbox, and the explicit restore:
 * who sees the mark, who may restore, booking work independent of restoring,
 * anonymised clients, workspace isolation, unchanged public booking.
 * Real database (PGlite), synthetic data.
 */
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const appointments = await import("../appointments.service");
const clients = await import("../clients.service");
const archive = await import("../clientArchive.service");
const inbox = await import("../inbox.service");
const { createPublicBooking } = await import("@/server/booking/publicBooking.service");
const { RepositoryForbiddenError } = await import("@/server/repository/errors");
const { getMessages } = await import("@/lib/i18n");

const OWNER = "aaaaaaaa-0000-4000-8000-000000000b01";
const ADMIN = "bbbbbbbb-0000-4000-8000-000000000b02";
const MANAGER = "cccccccc-0000-4000-8000-000000000b03";
const STAFF = "dddddddd-0000-4000-8000-000000000b04";
const OTHER_OWNER = "eeeeeeee-0000-4000-8000-000000000b05";
let db: PGlite;
let slug: string, otherSlug: string, wsId: string, otherWs: string, svcId: string, staffId: string;
const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const sessionOf = async (id: string, s = slug) => (as(id), getSession(s));
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const serviceClient = () => createPgliteSupabaseClient(db, { kind: "service" });
const publicDeps = () => ({ admin: serviceClient(), rateLimiter: createMemoryRateLimiter() });

let week = 1;
function monday() {
  const d = new Date(Date.now() + 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCDate(d.getUTCDate() + 7 * week++);
  return d.toISOString().slice(0, 10);
}
const book = (name: string, email: string, date = monday()) =>
  createPublicBooking(publicDeps(), { ip: `ip-${email}` }, { slug, serviceId: svcId, staffId, date, time: "10:00", client: { name, email, phone: "+49 170 5", notes: "" } });

async function archivedClient(name: string) {
  const owner = await sessionOf(OWNER);
  const c = await clients.createClient(owner, { name, email: `${name.toLowerCase()}@t.invalid`, phone: "", notes: "", tags: [] });
  await archive.archiveClient(owner, c.id);
  return c.id;
}
const onlineAppointment = async (clientId: string, session: Awaited<ReturnType<typeof getSession>>) =>
  (await appointments.listAppointments(session)).find((a): a is Extract<typeof a, { masked: false }> => !a.masked && a.clientId === clientId);

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${OTHER_OWNER}','x@t.invalid')`);
  const provision = async (u: string, e: string, base: string) =>
    ((await serviceClient().rpc("provision_workspace", { p_user_id: u, p_email: e, p_full_name: "", p_business_name: "Biz", p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[])[0];
  const a = await provision(OWNER, "o@t.invalid", "notice-a");
  const b = await provision(OTHER_OWNER, "x@t.invalid", "notice-b");
  wsId = a.out_workspace_id;
  slug = a.out_slug;
  otherWs = b.out_workspace_id;
  otherSlug = b.out_slug;
  await db.exec(`insert into profiles (id,email) values ('${ADMIN}','a@t.invalid'),('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid');
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${ADMIN}','admin'),('${wsId}','${MANAGER}','manager'),('${wsId}','${STAFF}','staff')`);
  staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
  svcId = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Haircut',30,40) returning id", [wsId]))[0].id;
}, 120_000);

afterAll(async () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  await db.close();
});

describe("archived client mark and explicit restore", () => {
  it("the mark reaches everyone who may view the client; only owner and admin may restore", async () => {
    const c = await archivedClient("Marked");
    await book("Marked", "marked@t.invalid");
    for (const id of [OWNER, ADMIN, MANAGER, STAFF]) {
      const s = await sessionOf(id);
      expect((await onlineAppointment(c, s))?.clientArchived, id).toBe(true);
      const canRestore = (await archive.archivedClientAccess(s, [c])).get(c)?.canRestore;
      expect(canRestore, id).toBe(id === OWNER || id === ADMIN);
    }
    const staff = await sessionOf(STAFF);
    await expect(archive.restoreClient(staff, c)).rejects.toThrow();
    const manager = await sessionOf(MANAGER);
    await expect(archive.restoreClient(manager, c)).rejects.toThrow();
    expect((await clients.getClient(await sessionOf(OWNER), c))?.archivedAt).toBeTruthy();
  });

  it("confirm, move and cancel work without restoring; the client stays archived", async () => {
    const c = await archivedClient("Independent");
    const date = monday();
    await book("Independent", "independent@t.invalid", date);
    const owner = await sessionOf(OWNER);
    const a = (await onlineAppointment(c, owner))!;
    expect((await appointments.updateAppointment(owner, a.id, { status: "confirmed" }))?.status).toBe("confirmed");
    expect((await appointments.moveAppointment(owner, { id: a.id, date, time: "11:00" }))?.time).toBe("11:00");
    expect((await appointments.cancelAppointment(owner, a.id))?.status).toBe("cancelled");
    expect((await clients.getClient(owner, c))?.archivedAt).toBeTruthy();
    expect((await clients.listClients(owner)).some((x) => x.id === c)).toBe(false);
  });

  it("explicit restore uses the existing checks and audit; the mark disappears, the booking is untouched", async () => {
    const c = await archivedClient("Back");
    await book("Back", "back@t.invalid");
    const admin = await sessionOf(ADMIN);
    const before = await onlineAppointment(c, admin);
    expect(await archive.restoreClient(admin, c)).toMatchObject({ status: "restored", archivedAt: null });
    const after = await onlineAppointment(c, admin);
    expect(after?.clientArchived).toBeUndefined();
    expect(after?.status).toBe(before?.status);
    expect((await clients.listClients(admin)).some((x) => x.id === c)).toBe(true);
    const audit = await q<{ summary: string; actor_id: string }>("select summary, actor_id from audit_logs where entity_id=$1 and summary like 'Client restored%'", [c]);
    expect(audit).toEqual([{ summary: "Client restored from archive", actor_id: ADMIN }]);
  });

  it("Inbox: mark and restore flag follow the same rules; a private event carries neither", async () => {
    const c = await archivedClient("Inboxed");
    await book("Inboxed", "inboxed@t.invalid");
    const of = async (id: string) => (await inbox.listInboxEvents(await sessionOf(id))).events.filter((e) => (e.details?.clientId ?? e.clientId) === c);
    expect((await of(OWNER)).every((e) => e.clientArchived && e.clientRestorable)).toBe(true);
    expect((await of(OWNER)).length).toBeGreaterThan(0);
    expect((await of(STAFF)).every((e) => e.clientArchived && !e.clientRestorable)).toBe(true);

    const owner = await sessionOf(OWNER);
    const a = (await onlineAppointment(c, owner))!;
    await q("update appointments set visibility='private' where id=$1", [a.id]);
    await q("update inbox_events set details = details || '{\"private\": true}'::jsonb - 'client_id' - 'client_name' where entity_id=$1", [a.id]);
    const events = (await inbox.listInboxEvents(await sessionOf(OWNER))).events.filter((e) => e.entityId === a.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.clientArchived || e.clientRestorable)).toBe(false);
  });

  it("a masked private appointment does not reveal the archive mark", async () => {
    const c = await archivedClient("Masked");
    await book("Masked", "masked@t.invalid");
    const owner = await sessionOf(OWNER);
    const a = (await onlineAppointment(c, owner))!;
    await q("update appointments set visibility='private' where id=$1", [a.id]);
    const seen = (await appointments.listAppointments(await sessionOf(MANAGER))).filter((x) => x.id === a.id);
    expect(JSON.stringify(seen)).not.toContain("clientArchived");
  });

  it("an anonymised client: no restore button, and the database refuses the restore", async () => {
    const c = await archivedClient("Anon");
    const [{ has0028 }] = await q<{ has0028: boolean }>("select to_regprocedure('public.anonymize_client_core(uuid,uuid,uuid)') is not null as has0028");
    if (has0028) {
      await q("select public.anonymize_client_core($1,$2,null)", [wsId, c]);
    } else {
      // This branch alone: simulate 0028's marker column.
      await q("alter table clients add column if not exists anonymized_at timestamptz");
      await q("update clients set anonymized_at = now() where id=$1", [c]);
    }
    const owner = await sessionOf(OWNER);
    expect((await archive.archivedClientAccess(owner, [c])).get(c)).toEqual({ canRestore: false });
    await expect(archive.restoreClient(owner, c)).rejects.toBeInstanceOf(RepositoryForbiddenError);
    expect((await clients.getClient(owner, c))?.archivedAt).toBeTruthy();
  });

  it("workspace isolation: another workspace sees nothing and cannot restore", async () => {
    const c = await archivedClient("Foreign");
    const other = await sessionOf(OTHER_OWNER, otherSlug);
    expect((await archive.archivedClientAccess(other, [c])).size).toBe(0);
    await expect(archive.restoreClient(other, c)).rejects.toThrow();
    expect((await q<{ a: string | null }>("select archived_at as a from clients where id=$1", [c]))[0].a).not.toBeNull();
    expect(otherWs).not.toBe(wsId);
  });

  it("the public booking is unchanged: same answer for a new, an active and an archived client; no restore", async () => {
    const archivedId = await archivedClient("Hidden");
    const owner = await sessionOf(OWNER);
    await clients.createClient(owner, { name: "Active", email: "active@t.invalid", phone: "", notes: "", tags: [] });
    const results = [await book("Hidden", "hidden@t.invalid"), await book("Active", "active@t.invalid"), await book("Brand New", "brandnew@t.invalid")];
    const keys = results.map((r) => Object.keys(r).sort().join(","));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).not.toMatch(/client/i);
    expect(results.every((r) => r.status === results[0].status)).toBe(true);
    expect((await clients.getClient(await sessionOf(OWNER), archivedId))?.archivedAt).toBeTruthy();
  });

  it("texts exist in all four languages", () => {
    for (const loc of ["en", "de", "ru", "uk"] as const) {
      const m = getMessages(loc);
      for (const t of [m.quickActions.clientArchivedNotice, m.quickActions.restoreClient, m.quickActions.clientRestored, m.quickActions.restoreFailed, m.inbox.clientArchivedBadge, m.inbox.restoreClient, m.inbox.restoreClientFailed]) {
        expect(t.length, loc).toBeGreaterThan(3);
      }
    }
  });
});
