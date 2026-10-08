import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

// Real PostgreSQL (PGlite running every migration, real triggers/RLS) under the real services.
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const wlSvc = await import("@/server/services/waitingList.service");
const inboxSvc = await import("@/server/services/inbox.service");
const { PermissionDeniedError } = await import("@/server/permissions/roles");
const { RepositoryForbiddenError, RepositoryNotFoundError } = await import("@/server/repository/errors");
const { toActionError } = await import("@/server/actions/result");
const { matchWaitingList, bookingLinkForEntry } = await import("@/features/waitingList/matching");
const { ZodError } = await import("zod");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const MANAGER = "cccccccc-0000-4000-8000-0000000000c3";
const STAFF = "dddddddd-0000-4000-8000-0000000000d4";
const ACCOUNTANT = "ffffffff-0000-4000-8000-0000000000f6";
const OTHER = "eeeeeeee-0000-4000-8000-0000000000e5";
const CLIENT_USER = "bbbbbbbb-0000-4000-8000-0000000000b2";

let db: PGlite;
let slug: string, wsId: string, otherSlug: string, otherWs: string;
let staffId: string, svcId: string, otherSvc: string, otherStaff: string, clientId: string, otherClient: string;

const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const service = () => createPgliteSupabaseClient(db, { kind: "service" });
const anon = () => createPgliteSupabaseClient(db, { kind: "anon" });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const session = async (user: string, s = slug) => (as(user), getSession(s));
const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const inbox = (types?: string[]) =>
  q<{ type: string; code: string; title: string; preview: string; client_id: string | null; actor_id: string | null; dedupe_key: string; is_read: boolean; entity_id: string }>(
    `select type, code, title, preview, client_id, actor_id, dedupe_key, is_read, entity_id from inbox_events where workspace_id = $1 ${types ? "and type = any($2)" : ""} order by created_at, id`,
    types ? [wsId, types] : [wsId],
  );
const auditCount = async (entity: string, ws = wsId) =>
  Number((await q<{ n: string }>("select count(*)::text n from audit_logs where workspace_id=$1 and entity_type=$2", [ws, entity]))[0].n);

let apptCounter = 0;
async function newAppt(o: { ws?: string; client?: string | null; svc?: string | null; staff?: string; startsAt?: string; status?: string; visibility?: string } = {}) {
  const starts = o.startsAt ?? hoursFromNow(300 + apptCounter++ * 2);
  return (
    await q<{ id: string }>(
      `insert into appointments (workspace_id, client_id, service_id, staff_id, starts_at, ends_at, status, visibility, source)
       values ($1,$2,$3,$4,$5::timestamptz,$5::timestamptz + interval '30 minutes',$6,$7,'user') returning id`,
      [o.ws ?? wsId, o.client === undefined ? clientId : o.client, o.svc === undefined ? svcId : o.svc, o.staff ?? staffId, starts, o.status ?? "pending", o.visibility ?? "normal"],
    )
  )[0].id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@t.invalid'),('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','a@t.invalid'),('${OTHER}','x@t.invalid'),('${CLIENT_USER}','c@t.invalid')`);
  const prov = async (user: string, email: string, name: string, base: string) =>
    ((await service().rpc("provision_workspace", { p_user_id: user, p_email: email, p_full_name: "", p_business_name: name, p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[])[0];
  const a = await prov(OWNER, "o@t.invalid", "Biz", "wl-biz");
  wsId = a.out_workspace_id;
  slug = a.out_slug;
  const b = await prov(OTHER, "x@t.invalid", "Other", "wl-other");
  otherWs = b.out_workspace_id;
  otherSlug = b.out_slug;
  await db.exec(`insert into profiles (id,email) values ('${MANAGER}','m@t.invalid'),('${STAFF}','s@t.invalid'),('${ACCOUNTANT}','a@t.invalid') on conflict do nothing;
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${MANAGER}','manager'),('${wsId}','${STAFF}','staff'),('${wsId}','${ACCOUNTANT}','accountant')`);
  staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
  otherStaff = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [otherWs]))[0].id;
  svcId = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Cut',30,40) returning id", [wsId]))[0].id;
  otherSvc = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Theirs',30,10) returning id", [otherWs]))[0].id;
  clientId = (await q<{ id: string }>("insert into clients (workspace_id,name,email,phone) values ($1,'Mia Weberlong','mia@example.test','+49 170 1') returning id", [wsId]))[0].id;
  otherClient = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Other Person','op@example.test') returning id", [otherWs]))[0].id;
}, 120_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

const base = { earliestDate: "2026-10-10", latestDate: "2026-10-20" };

describe("Waiting list: create / edit / status / audit", () => {
  let entryId: string;

  it("creates an entry for a client: names resolved, contact snapshot, one audit entry, one inbox event (no PII in audit)", async () => {
    const s = await session(OWNER);
    const before = await auditCount("waitingListEntry");
    const e = await wlSvc.addWaitingListEntry(s, { ...base, clientId, serviceId: svcId, preferredStaffId: staffId, preferredDays: [1, 3], preferredTimeStart: "14:00", preferredTimeEnd: "18:00", notes: "prefers afternoons" });
    entryId = e.id;
    expect(e).toMatchObject({ client: "Mia Weberlong", clientId, service: "Cut", serviceId: svcId, preferredStaffId: staffId, status: "waiting", preferredDays: [1, 3], preferredTimeStart: "14:00", preferredTimeEnd: "18:00", guestPhone: "+49 170 1", guestEmail: "mia@example.test" });
    expect(e.preferredStaff).toBeTruthy();
    expect(await auditCount("waitingListEntry")).toBe(before + 1);
    const audit = await q<{ summary: string; actor_id: string }>("select summary, actor_id from audit_logs where entity_type='waitingListEntry' and entity_id=$1", [e.id]);
    expect(audit).toHaveLength(1);
    expect(audit[0].summary).not.toMatch(/Mia|mia@|\+49/);
    const ev = await inbox(["waiting_list"]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ code: "waiting.added", dedupe_key: `waiting:${e.id}:created`, client_id: clientId, actor_id: OWNER });
    expect(ev[0].preview).toBe("Mia · Cut");
    expect(ev[0].preview).not.toMatch(/Weberlong/);
  });

  it("creates a guest entry (no client row) and validates input", async () => {
    const s = await session(MANAGER);
    const g = await wlSvc.addWaitingListEntry(s, { ...base, client: "Walk In", guestPhone: "123", serviceId: svcId });
    expect(g).toMatchObject({ client: "Walk In", clientId: null, guestPhone: "123", preferredStaff: null, status: "waiting" });
    await expect(wlSvc.addWaitingListEntry(s, { ...base, serviceId: svcId })).rejects.toBeInstanceOf(ZodError);
    await expect(wlSvc.addWaitingListEntry(s, { ...base, client: "X" })).rejects.toBeInstanceOf(ZodError);
    await expect(wlSvc.addWaitingListEntry(s, { client: "X", serviceId: svcId, earliestDate: "2026-10-20", latestDate: "2026-10-10" })).rejects.toBeInstanceOf(ZodError);
    await expect(wlSvc.addWaitingListEntry(s, { ...base, client: "X", serviceId: svcId, preferredTimeStart: "18:00", preferredTimeEnd: "09:00" })).rejects.toBeInstanceOf(ZodError);
    await expect(wlSvc.addWaitingListEntry(s, { ...base, client: "X", serviceId: svcId, preferredDays: [7] })).rejects.toBeInstanceOf(ZodError);
    await expect(wlSvc.addWaitingListEntry(s, { ...base, client: "X", serviceId: "nope" })).rejects.toBeInstanceOf(ZodError);
    await expect(wlSvc.addWaitingListEntry(s, { earliestDate: "2026-02-31", latestDate: "2026-03-01", client: "X", serviceId: svcId })).rejects.toBeInstanceOf(ZodError);
  });

  it("edit, contact, booked, close, reopen: one audit entry per change; history is kept", async () => {
    const s = await session(OWNER);
    const n0 = await auditCount("waitingListEntry");
    const upd = await wlSvc.updateWaitingListEntry(s, entryId, { notes: "calls only", latestDate: "2026-10-25" });
    expect(upd).toMatchObject({ notes: "calls only", latestDate: "2026-10-25", status: "waiting" });
    expect(await auditCount("waitingListEntry")).toBe(n0 + 1);

    expect((await wlSvc.setWaitingListStatus(s, entryId, "contacted")).status).toBe("contacted");
    expect(await auditCount("waitingListEntry")).toBe(n0 + 2);
    expect((await q<{ action: string }>("select action from audit_logs where entity_id=$1 order by created_at desc, id limit 1", [entryId]))[0].action).toBe("statusChanged");

    const appt = await newAppt();
    const booked = await wlSvc.updateWaitingListEntry(s, entryId, { status: "booked", bookedAppointmentId: appt });
    expect(booked).toMatchObject({ status: "booked", bookedAppointmentId: appt });
    expect((await wlSvc.setWaitingListStatus(s, entryId, "closed")).status).toBe("closed");
    // closed entries stay listed (history) but never match a freed slot
    const all = await wlSvc.listWaitingList(s);
    expect(all.find((e) => e.id === entryId)?.status).toBe("closed");
    const slot = { service: "Cut", staff: all.find((e) => e.id === entryId)!.preferredStaff!, date: "2026-10-12", time: "15:00" };
    const matchIds = async () => (await wlSvc.findWaitingListMatches(s, slot)).map((e) => e.id);
    expect(await matchIds()).not.toContain(entryId);
    expect((await wlSvc.setWaitingListStatus(s, entryId, "waiting")).status).toBe("waiting");
    expect(await matchIds()).toContain(entryId);
    await expect(wlSvc.setWaitingListStatus(s, entryId, "weird" as never)).rejects.toBeInstanceOf(ZodError);
    await expect(wlSvc.updateWaitingListEntry(s, entryId, { status: "waiting", workspace_id: otherWs } as never)).rejects.toBeInstanceOf(ZodError);
  });

  it("no hard delete for users: DELETE is not granted, rows survive", async () => {
    as(OWNER);
    const r = await current.from("waiting_list").delete().eq("id", entryId);
    expect(r.error).toBeTruthy();
    expect(await q("select 1 from waiting_list where id=$1", [entryId])).toHaveLength(1);
  });

  it("matching helpers: closed/booked never match; the booking link prefills client and date for the Calendar", () => {
    const entry = { id: "1", client: "Mia W", service: "Cut", preferredStaff: null, earliestDate: "2026-10-10", latestDate: "2026-10-20", preferredDays: [], preferredTimeStart: null, preferredTimeEnd: null };
    const slot = { service: "Cut", staff: "Anna", date: "2026-10-12", time: "10:00" };
    expect(matchWaitingList(slot, [entry])).toHaveLength(1);
    expect(matchWaitingList(slot, [{ ...entry, status: "closed" }, { ...entry, status: "booked" }])).toHaveLength(0);
    expect(matchWaitingList(slot, [{ ...entry, status: "contacted" }])).toHaveLength(1);
    expect(bookingLinkForEntry("biz", entry, "2026-10-05")).toBe("/biz/calendar?create=appointment&client=Mia+W&date=2026-10-10");
    expect(bookingLinkForEntry("biz", entry, "2026-10-15")).toBe("/biz/calendar?create=appointment&client=Mia+W&date=2026-10-15");
  });
});

describe("Waiting list: roles, tenant isolation, forged sessions, FK guards, anon", () => {
  it("manager and staff may work the list, the accountant may not", async () => {
    for (const id of [MANAGER, STAFF]) {
      const s = await session(id);
      expect((await wlSvc.listWaitingList(s)).length).toBeGreaterThan(0);
      const e = await wlSvc.addWaitingListEntry(s, { ...base, client: `By ${id.slice(0, 2)}`, serviceId: svcId });
      expect((await wlSvc.setWaitingListStatus(s, e.id, "contacted")).status).toBe("contacted");
    }
    const acc = await session(ACCOUNTANT);
    await expect(wlSvc.listWaitingList(acc)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(wlSvc.addWaitingListEntry(acc, { ...base, client: "No", serviceId: svcId })).rejects.toBeInstanceOf(PermissionDeniedError);
    // even a forged session claiming the owner role is stopped by RLS for a non-member of appointments.view
    const forgedAcc = { userId: ACCOUNTANT, workspaceId: wsId, role: "owner" as const };
    as(ACCOUNTANT);
    expect(await wlSvc.listWaitingList(forgedAcc)).toEqual([]);
    await expect(wlSvc.addWaitingListEntry(forgedAcc, { ...base, client: "No", serviceId: svcId })).rejects.toBeInstanceOf(RepositoryForbiddenError);
  });

  it("tenant isolation: B cannot read or touch A's entries (real and forged session)", async () => {
    const a = await session(OWNER);
    const mine = (await wlSvc.listWaitingList(a))[0];
    as(OTHER);
    await expect(getSession(slug)).rejects.toThrow();
    const b = await getSession(otherSlug);
    expect(await wlSvc.listWaitingList(b)).toEqual([]);
    const forged = { userId: OTHER, workspaceId: wsId, role: "owner" as const };
    expect(await wlSvc.listWaitingList(forged)).toEqual([]);
    await expect(wlSvc.updateWaitingListEntry(forged, mine.id, { notes: "hacked" })).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(wlSvc.setWaitingListStatus(forged, mine.id, "closed")).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await expect(wlSvc.addWaitingListEntry(forged, { ...base, client: "Evil", serviceId: svcId })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    expect(toActionError(new RepositoryForbiddenError("x"))).toBe("forbidden");
    // B's own entry is invisible to A
    const bEntry = await wlSvc.addWaitingListEntry(b, { ...base, client: "B Guest", serviceId: otherSvc });
    as(OWNER);
    expect((await wlSvc.listWaitingList(await getSession(slug))).map((e) => e.id)).not.toContain(bEntry.id);
    expect((await q("select notes from waiting_list where id=$1", [mine.id]))[0]).not.toMatchObject({ notes: "hacked" });
  });

  it("same-workspace guards: another business's service, staff, client or appointment is refused", async () => {
    const s = await session(OWNER);
    await expect(wlSvc.addWaitingListEntry(s, { ...base, client: "X", serviceId: otherSvc })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(wlSvc.addWaitingListEntry(s, { ...base, client: "X", serviceId: svcId, preferredStaffId: otherStaff })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(wlSvc.addWaitingListEntry(s, { ...base, clientId: otherClient, serviceId: svcId })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    const mine = (await wlSvc.listWaitingList(s))[0];
    const foreignAppt = await newAppt({ ws: otherWs, client: otherClient, svc: otherSvc, staff: otherStaff });
    await expect(wlSvc.updateWaitingListEntry(s, mine.id, { bookedAppointmentId: foreignAppt })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(wlSvc.updateWaitingListEntry(s, mine.id, { serviceId: otherSvc })).rejects.toBeInstanceOf(RepositoryForbiddenError);
    // moving a row to another workspace is impossible
    as(OWNER);
    const moved = await current.from("waiting_list").update({ workspace_id: otherWs }).eq("id", mine.id);
    expect(moved.error).toBeTruthy();
  });

  it("anon sees and writes nothing", async () => {
    const r = await anon().from("waiting_list").select("id");
    expect(r.error).toBeTruthy();
    const w = await anon().from("waiting_list").insert({ workspace_id: wsId, guest_name: "x", earliest_date: "2026-10-10", latest_date: "2026-10-11", service_id: svcId });
    expect(w.error).toBeTruthy();
  });
});

describe("Inbox: appointment triggers", () => {
  it("a public booking creates exactly one booking_created event with a safe preview", async () => {
    const before = (await inbox(["booking_created"])).length;
    const rpc = await service().rpc("create_public_booking", {
      p_workspace_id: wsId, p_service_id: svcId, p_staff_id: staffId, p_resource_id: null,
      p_starts_at: hoursFromNow(96), p_name: "Guest Jones", p_email: "guest.jones@example.test", p_phone: "", p_notes: "my secret note",
    });
    expect(rpc.error).toBeNull();
    const rows = await inbox(["booking_created"]);
    expect(rows).toHaveLength(before + 1);
    const ev = rows[rows.length - 1];
    expect(ev).toMatchObject({ type: "booking_created", code: "booking.created", title: "New booking", actor_id: null });
    expect(ev.preview.startsWith("Guest · Cut · ")).toBe(true);
    expect(JSON.stringify(ev)).not.toMatch(/Jones|guest\.jones|secret/);
    expect(ev.client_id).toBeTruthy();
    expect(ev.dedupe_key).toMatch(/^appointment:[0-9a-f-]{36}:pending:\d+$/);
    expect(ev.entity_id).toBeTruthy();
  });

  it("client cancel and reschedule (My bookings RPCs) each create their event", async () => {
    const a = (await service().rpc("create_public_booking", {
      p_workspace_id: wsId, p_service_id: svcId, p_staff_id: staffId, p_resource_id: null,
      p_starts_at: hoursFromNow(120), p_name: "Cara Client", p_email: "cara@example.test", p_phone: "", p_notes: "",
    })).data as { out_appointment_id: string }[];
    const id = a[0].out_appointment_id;
    const token = (await service().rpc("issue_booking_claim", { p_appointment_id: id })).data as string;
    expect((await service().rpc("claim_booking", { p_user_id: CLIENT_USER, p_token: token })).error).toBeNull();

    const r = await service().rpc("reschedule_my_booking", { p_user_id: CLIENT_USER, p_appointment_id: id, p_new_starts_at: hoursFromNow(144), p_staff_id: staffId, p_resource_id: null });
    expect(r.error).toBeNull();
    expect((await inbox(["booking_rescheduled"])).filter((e) => e.entity_id === id)).toHaveLength(1);

    const c = await service().rpc("cancel_my_booking", { p_user_id: CLIENT_USER, p_appointment_id: id });
    expect(c.error).toBeNull();
    const cancelled = (await inbox(["booking_cancelled"])).filter((e) => e.entity_id === id);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ code: "booking.cancelled", title: "Booking cancelled" });
    expect(cancelled[0].preview).toMatch(/^Cara · Cut · /);
    expect(cancelled[0].preview).not.toMatch(/Client/);
    expect((await inbox()).filter((e) => e.entity_id === id)).toHaveLength(3); // created + moved + cancelled
  });

  it("business changes: confirm, move, cancel by the owner; unrelated edits create nothing", async () => {
    const id = await newAppt();
    const count = async () => (await inbox()).filter((e) => e.entity_id === id).length;
    expect(await count()).toBe(1);
    as(OWNER);
    await current.from("appointments").update({ internal_notes: "x" }).eq("id", id);
    await current.from("appointments").update({ status: "checked_in" }).eq("id", id);
    expect(await count()).toBe(1);
    await current.from("appointments").update({ status: "confirmed" }).eq("id", id);
    expect((await inbox(["booking_status"])).filter((e) => e.entity_id === id).map((e) => e.code)).toEqual(["booking.confirmed"]);
    expect((await inbox()).find((e) => e.code === "booking.confirmed" && e.entity_id === id)?.actor_id).toBe(OWNER);
    await current.from("appointments").update({ starts_at: hoursFromNow(200), ends_at: hoursFromNow(201) }).eq("id", id);
    expect(await count()).toBe(3);
    await current.from("appointments").update({ status: "cancelled" }).eq("id", id);
    expect(await count()).toBe(4);
  });

  it("replaying the same dedupe key never duplicates (direct insert, status bounce, RPC)", async () => {
    const id = await newAppt();
    const keyRow = (await inbox()).find((e) => e.entity_id === id)!;
    const n = async () => (await inbox()).length;
    const before = await n();
    // 1. direct replay of the producer insert
    await q(
      `insert into inbox_events (workspace_id, type, title, dedupe_key) values ($1,'booking_created','New booking',$2) on conflict (workspace_id, dedupe_key) do nothing`,
      [wsId, keyRow.dedupe_key],
    );
    expect(await n()).toBe(before);
    // 2. plain duplicate insert violates the unique key
    await expect(q(`insert into inbox_events (workspace_id, type, title, dedupe_key) values ($1,'booking_created','dup',$2)`, [wsId, keyRow.dedupe_key])).rejects.toMatchObject({ code: "23505" });
    // 3. cancel -> reopen -> cancel at the same time: the second cancel is the same key
    as(OWNER);
    await current.from("appointments").update({ status: "cancelled" }).eq("id", id);
    await current.from("appointments").update({ status: "pending" }).eq("id", id);
    await current.from("appointments").update({ status: "cancelled" }).eq("id", id);
    expect((await inbox(["booking_cancelled"])).filter((e) => e.entity_id === id)).toHaveLength(1);
    // 4. the service helper reports a duplicate as "not stored"
    const s = await session(OWNER);
    const input = { type: "work" as const, title: "Lead converted", dedupeKey: `work:test:${id}` };
    expect(await inboxSvc.recordInboxEvent(s, input)).toBe(true);
    expect(await inboxSvc.recordInboxEvent(s, input)).toBe(false);
    expect((await inbox(["work"])).filter((e) => e.dedupe_key === input.dedupeKey)).toHaveLength(1);
  });

  it("PRIVATE / owner-only appointments produce a generic event: no client, no preview", async () => {
    const priv = await newAppt({ visibility: "private" });
    const owner = await newAppt({ visibility: "owner_only" });
    const normal = await newAppt();
    const events = await inbox();
    for (const id of [priv, owner]) {
      const ev = events.find((e) => e.entity_id === id)!;
      expect(ev).toMatchObject({ title: "New booking", preview: "", client_id: null });
      expect(JSON.stringify(ev)).not.toMatch(/Mia|Weber|Cut/);
    }
    expect(events.find((e) => e.entity_id === normal)!.preview).toMatch(/^Mia · Cut · /);
    // a reader without private access sees the event row, but nothing identifying
    const staff = await session(STAFF);
    const list = await inboxSvc.listInboxEvents(staff);
    const seen = list.events.find((e) => e.entityId === priv)!;
    expect(seen).toBeTruthy();
    expect(seen.preview).toBe("");
    expect(seen.clientId).toBeNull();
    // later status changes of a private appointment stay generic too
    await q("update appointments set status='cancelled' where id=$1", [priv]);
    const cancelled = (await inbox(["booking_cancelled"])).find((e) => e.entity_id === priv)!;
    expect(cancelled).toMatchObject({ title: "Booking cancelled", preview: "", client_id: null });
  });
});

describe("Inbox: read state, permissions, isolation", () => {
  it("lists newest first with an unread count; mark read / unread / all read", async () => {
    const s = await session(OWNER);
    const list = await inboxSvc.listInboxEvents(s);
    expect(list.events.length).toBeGreaterThan(5);
    expect(list.unreadCount).toBe(list.events.filter((e) => !e.isRead).length);
    const times = list.events.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    const first = list.events[0];
    const read = await inboxSvc.setInboxEventRead(s, first.id, true);
    expect(read.isRead).toBe(true);
    expect(read.readAt).toBeTruthy();
    expect((await inboxSvc.getInboxUnreadCount(s))).toBe(list.unreadCount - 1);
    const unread = await inboxSvc.setInboxEventRead(s, first.id, false);
    expect(unread).toMatchObject({ isRead: false, readAt: null });
    const marked = await inboxSvc.markAllInboxEventsRead(s);
    expect(marked).toBe(list.unreadCount);
    expect(await inboxSvc.getInboxUnreadCount(s)).toBe(0);
    expect(await inboxSvc.markAllInboxEventsRead(s)).toBe(0);
    // reading an event never changes its content
    const after = (await inboxSvc.listInboxEvents(s)).events.find((e) => e.id === first.id)!;
    expect({ ...after, isRead: first.isRead, readAt: first.readAt }).toEqual(first);
  });

  it("staff can read and mark read but cannot create or change events; accountant sees nothing", async () => {
    const staff = await session(STAFF);
    expect((await inboxSvc.listInboxEvents(staff)).events.length).toBeGreaterThan(0);
    expect((await inboxSvc.setInboxEventRead(staff, (await inboxSvc.listInboxEvents(staff)).events[0].id, true)).isRead).toBe(true);
    as(STAFF);
    // no INSERT privilege / policy, no DELETE, only is_read / read_at are updatable
    const ins = await current.from("inbox_events").insert({ workspace_id: wsId, type: "system", title: "forged", dedupe_key: "forged:1" });
    expect(ins.error).toBeTruthy();
    expect((await current.from("inbox_events").delete().eq("workspace_id", wsId)).error).toBeTruthy();
    const edit = await current.from("inbox_events").update({ title: "hacked" }).eq("workspace_id", wsId);
    expect(edit.error?.code).toBe("42501");
    // service-side events are permission-checked per type
    const viaRpc = (type: string) =>
      current.rpc("record_inbox_event", { p_workspace_id: wsId, p_type: type, p_code: "", p_title: "t", p_preview: "", p_entity_type: "", p_entity_id: "", p_client_id: null, p_dedupe_key: `rpc:${type}:${Math.random()}` });
    expect((await viaRpc("work")).error?.code).toBe("42501");
    expect((await viaRpc("finance")).error?.code).toBe("42501");
    expect((await viaRpc("system")).error?.code).toBe("42501");
    expect((await viaRpc("booking_created")).error?.code).toBe("42501");
    expect((await viaRpc("waiting_list")).error).toBeNull();
    const acc = await session(ACCOUNTANT);
    await expect(inboxSvc.listInboxEvents(acc)).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(inboxSvc.markAllInboxEventsRead(acc)).rejects.toBeInstanceOf(PermissionDeniedError);
    as(ACCOUNTANT);
    expect((await current.from("inbox_events").select("id")).data).toEqual([]);
    expect(await q("select 1 from inbox_events where title='forged' or title='hacked'")).toHaveLength(0);
  });

  it("tenant isolation: B reads none of A's events, cannot mark them read, and mark-all only touches its own", async () => {
    const a = await session(OWNER);
    await q("update inbox_events set is_read=false, read_at=null where workspace_id=$1", [wsId]);
    const aUnread = (await inboxSvc.listInboxEvents(a)).unreadCount;
    expect(aUnread).toBeGreaterThan(0);
    const aEvent = (await inboxSvc.listInboxEvents(a)).events[0];

    const b = await session(OTHER, otherSlug);
    // B has its own bookings too
    await newAppt({ ws: otherWs, client: otherClient, svc: otherSvc, staff: otherStaff });
    const bList = await inboxSvc.listInboxEvents(b);
    expect(bList.events.length).toBeGreaterThan(0);
    expect(bList.events.every((e) => e.id !== aEvent.id)).toBe(true);
    const forged = { userId: OTHER, workspaceId: wsId, role: "owner" as const };
    expect(await inboxSvc.listInboxEvents(forged)).toEqual({ events: [], unreadCount: 0 });
    await expect(inboxSvc.setInboxEventRead(forged, aEvent.id, true)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    expect(await inboxSvc.markAllInboxEventsRead(forged)).toBe(0);
    await expect(inboxSvc.setInboxEventRead(b, aEvent.id, true)).rejects.toBeInstanceOf(RepositoryNotFoundError);
    await inboxSvc.markAllInboxEventsRead(b);
    expect((await inboxSvc.listInboxEvents(await session(OWNER))).unreadCount).toBe(aUnread);
    // a forged service-side event for the other tenant is refused, so is a client id from another tenant
    as(OTHER);
    const evil = await current.rpc("record_inbox_event", { p_workspace_id: wsId, p_type: "work", p_code: "", p_title: "x", p_preview: "", p_entity_type: "", p_entity_id: "", p_client_id: null, p_dedupe_key: "evil:1" });
    expect(evil.error?.code).toBe("42501");
    as(OWNER);
    const crossClient = await current.rpc("record_inbox_event", { p_workspace_id: wsId, p_type: "work", p_code: "", p_title: "x", p_preview: "", p_entity_type: "", p_entity_id: "", p_client_id: otherClient, p_dedupe_key: "evil:2" });
    expect(crossClient.error?.code).toBe("23514");
    // the same dedupe key may exist in two workspaces (unique per workspace)
    expect(await q("select 1 from inbox_events where dedupe_key like 'evil:%'")).toHaveLength(0);
  });

  it("anon has nothing; trigger functions and guards are not callable by users", async () => {
    expect((await anon().from("inbox_events").select("id")).error).toBeTruthy();
    expect((await anon().from("inbox_events").insert({ workspace_id: wsId, type: "system", title: "x", dedupe_key: "anon:1" })).error).toBeTruthy();
    const call = await anon().rpc("record_inbox_event", { p_workspace_id: wsId, p_type: "system", p_code: "", p_title: "t", p_preview: "", p_entity_type: "", p_entity_id: "", p_client_id: null, p_dedupe_key: "anon:2" });
    expect(call.error).toBeTruthy();
    for (const fn of ["record_appointment_inbox_event()", "guard_inbox_event()", "guard_waiting_list()"]) {
      const r = await q<{ a: boolean; b: boolean; c: boolean }>(
        `select has_function_privilege('anon','public.${fn}','execute') a, has_function_privilege('authenticated','public.${fn}','execute') b, has_function_privilege('public','public.${fn}','execute') c`,
      );
      expect(r[0], fn).toEqual({ a: false, b: false, c: false });
    }
    // definer functions pin their search_path
    const cfg = await q<{ proconfig: string[] | null }>("select proconfig from pg_proc where proname in ('record_appointment_inbox_event','record_inbox_event','guard_inbox_event','guard_waiting_list')");
    expect(cfg).toHaveLength(4);
    for (const c of cfg) expect(c.proconfig?.join(",")).toMatch(/search_path=/);
  });

  it("recordInboxEvent never throws for the caller: a refused event returns false", async () => {
    const staff = await session(STAFF);
    expect(await inboxSvc.recordInboxEvent(staff, { type: "finance", title: "Invoice paid", dedupeKey: "fin:1" })).toBe(false);
    const owner = await session(OWNER);
    expect(await inboxSvc.recordInboxEvent(owner, { type: "finance", code: "finance.paid", title: "Invoice paid", preview: "x".repeat(500), dedupeKey: "fin:1" })).toBe(true);
    expect((await q<{ preview: string }>("select preview from inbox_events where dedupe_key='fin:1'"))[0].preview).toHaveLength(200);
  });
});
