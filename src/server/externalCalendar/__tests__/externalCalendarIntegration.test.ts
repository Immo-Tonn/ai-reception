import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { D, makeWorld, PINNED_NOW, type Biz, type World } from "@/server/booking/__tests__/schedulingHarness";
import { MockCalendarProvider } from "../mockProvider";
import { createSecretBox, sha256Hex, tokenContext } from "../crypto";
import { createSupabaseExternalCalendarStore } from "../store";
import type { ExternalBusyLoader } from "../engineInput";
import type { ExternalCalendarDeps } from "../service";

// Business services call createSupabaseServerClient() (user, RLS) and the external busy loader (service role).
let current: SupabaseClient;
let loader: ExternalBusyLoader | undefined;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));
vi.mock("@/server/externalCalendar/deps", () => ({ getExternalBusyLoader: () => loader }));

const svc = await import("../service");
const appointments = await import("@/server/services/appointments.service");
const { getSession } = await import("@/server/auth/session");

/**
 * End-to-end on a real PostgreSQL (all migrations incl. 0025): connect link ->
 * OAuth (mock Google) -> encrypted storage -> busy cache -> the ONE availability
 * engine for guests, business and the final check before writing.
 * Clock pinned: Sun 2026-10-04 20:00 Berlin; Mon 5 Oct is a working day (09:00-18:00).
 */
let db: PGlite;
let w: World;
let google: MockCalendarProvider;
let deps: ExternalCalendarDeps;
const key = randomBytes(32);
const REDIRECT = "https://app.test/api/integrations/google-calendar/callback";
const setNow = (iso: string | Date) => vi.setSystemTime(new Date(iso));
const later = (minutes: number) => setNow(new Date(Date.parse(PINNED_NOW) + minutes * 60_000));

/** Berlin wall clock (UTC+2 in October) -> ISO instant. */
const berlin = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+02:00`).toISOString();

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  setNow(PINNED_NOW);
  db = await createMigratedDb();
  w = makeWorld(db);
}, 120_000);

beforeEach(() => {
  setNow(PINNED_NOW);
  google = new MockCalendarProvider();
  deps = {
    store: createSupabaseExternalCalendarStore(createPgliteSupabaseClient(db, { kind: "service" })),
    provider: google,
    tokens: createSecretBox(key, "tokens"),
    cookies: createSecretBox(key, "cookies"),
  };
  loader = (args) => svc.loadExternalBusy(deps, args);
});

afterAll(() => {
  vi.useRealTimers();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

const ownerSession = (b: Biz) => ({ userId: b.owner, workspaceId: b.ws, role: "owner" as const });
const bookingDeps = () => w.deps({ externalBusy: (a) => svc.loadExternalBusy(deps, a) });
const times = async (b: Biz, service: string, staff: string | null, date: string) =>
  [...new Set((await (await import("@/server/booking/publicBooking.service")).getPublicSlots(bookingDeps(), { ip: "198.51.100.9" }, { slug: b.slug, serviceId: service, staffId: staff, date })).map((s) => s.time))].sort();
const bookAs = async (b: Biz, service: string, staff: string | null, date: string, time: string) => {
  const { createPublicBooking } = await import("@/server/booking/publicBooking.service");
  return w.outcome(createPublicBooking(bookingDeps(), { ip: "198.51.100.9" }, { slug: b.slug, serviceId: service, staffId: staff, date, time, client: w.guest() }));
};

/** Full connect flow for one staff member's (mock) Google account. Returns the setup cookie. */
async function connect(b: Biz, staffId: string, account: string, busy: { start: string; end: string }[] = [], extraCalendars: { id: string; name: string; busy: { start: string; end: string }[] }[] = []) {
  google.accounts.set(account, {
    calendars: [{ id: `${account}@primary`, name: "Personal", primary: true, busy }, ...extraCalendars.map((c) => ({ ...c, primary: false }))],
  });
  const code = `code-${account}`;
  google.codes.set(code, account);
  const { url } = await svc.createConnectLink(deps, ownerSession(b), staffId, "https://app.test");
  const token = url.split("/").pop()!;
  const start = await svc.startAuthorization(deps, token, REDIRECT);
  const state = new URL(start.authorizationUrl).searchParams.get("state");
  const done = await svc.completeAuthorization(deps, { flowCookie: start.flowCookie, state, code, error: null, redirectUri: REDIRECT });
  return { setupCookie: done.setupCookie, token };
}

async function salon() {
  const b = await w.biz("salon");
  const masters = [];
  for (const name of ["M1", "M2", "M3", "M4", "M5"]) masters.push(await w.staff(b, name));
  const cut = await w.service(b, "Cut", 60);
  return { b, masters, cut };
}

describe("the salon example: five masters, one with Google busy 14:00-15:00", () => {
  it("master 1 cannot be booked 14:00-15:00, the others can; 'any' still offers 14:00", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "m1", [{ start: berlin(D.mon, "14:00"), end: berlin(D.mon, "15:00") }]);

    const m1 = await times(b, cut, masters[0], D.mon);
    expect(m1).not.toContain("14:00");
    expect(m1).not.toContain("13:30"); // 60-minute service would run into the event
    expect(m1).toContain("13:00");
    expect(m1).toContain("15:00");
    expect(await times(b, cut, masters[1], D.mon)).toContain("14:00");
    expect(await times(b, cut, null, D.mon)).toContain("14:00");

    expect(await bookAs(b, cut, masters[0], D.mon, "14:00")).toBe("slot_unavailable");
    expect(await bookAs(b, cut, masters[1], D.mon, "14:00")).toBe("ok");
    // "Any specialist" at 14:00 is never assigned to master 1.
    expect(await bookAs(b, cut, null, D.mon, "14:00")).toBe("ok");
    const assigned = await w.q<{ staff_id: string }>("select staff_id from appointments where workspace_id=$1 and starts_at=$2", [b.ws, berlin(D.mon, "14:00")]);
    expect(assigned.map((r) => r.staff_id)).not.toContain(masters[0]);
  });

  it("an event cancelled in Google frees the time again after the next refresh (5 min)", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "m1b", [{ start: berlin(D.mon, "14:00"), end: berlin(D.mon, "15:00") }]);
    expect(await times(b, cut, masters[0], D.mon)).not.toContain("14:00");

    google.accounts.get("m1b")!.calendars[0].busy = [];
    later(2);
    expect(await times(b, cut, masters[0], D.mon)).not.toContain("14:00"); // still cached
    later(6);
    expect(await times(b, cut, masters[0], D.mon)).toContain("14:00");
  });

  it("an event moved in Google moves the blocked time", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "m1c", [{ start: berlin(D.mon, "10:00"), end: berlin(D.mon, "11:00") }]);
    expect(await times(b, cut, masters[0], D.mon)).not.toContain("10:00");
    google.accounts.get("m1c")!.calendars[0].busy = [{ start: berlin(D.mon, "16:00"), end: berlin(D.mon, "17:00") }];
    later(6);
    const after = await times(b, cut, masters[0], D.mon);
    expect(after).toContain("10:00");
    expect(after).not.toContain("16:00");
  });

  it("available dates: a day fully busy in Google is not offered for that master, but is for 'any'", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "m1d", [{ start: berlin(D.tue, "00:00"), end: berlin(D.wed, "00:00") }]);
    const { getPublicAvailableDates } = await import("@/server/booking/publicBooking.service");
    const datesM1 = await getPublicAvailableDates(bookingDeps(), { ip: "198.51.100.9" }, { slug: b.slug, serviceId: cut, staffId: masters[0], fromDate: D.mon, days: 5 });
    expect(datesM1).toContain(D.mon);
    expect(datesM1).not.toContain(D.tue);
    const datesAny = await getPublicAvailableDates(bookingDeps(), { ip: "198.51.100.9" }, { slug: b.slug, serviceId: cut, staffId: null, fromDate: D.mon, days: 5 });
    expect(datesAny).toContain(D.tue);
  });

  it("several calendars: busy time of every selected calendar counts; unselected ones do not", async () => {
    const { b, masters, cut } = await salon();
    const { setupCookie } = await connect(b, masters[0], "m1e", [], [{ id: "work", name: "Work", busy: [{ start: berlin(D.mon, "11:00"), end: berlin(D.mon, "12:00") }] }]);
    expect(await times(b, cut, masters[0], D.mon)).toContain("11:00"); // only primary selected by default

    const choices = await svc.getCalendarChoices(deps, setupCookie);
    expect(choices.calendars.map((c) => [c.id, c.selected])).toEqual([
      ["m1e@primary", true],
      ["work", false],
    ]);
    await svc.saveCalendarChoices(deps, setupCookie, ["m1e@primary", "work"]);
    expect(await times(b, cut, masters[0], D.mon)).not.toContain("11:00");
    // An id this Google account does not have is refused.
    await expect(svc.saveCalendarChoices(deps, setupCookie, ["someone-else@example.com"])).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.saveCalendarChoices(deps, setupCookie, [])).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("safety policy when Google cannot answer", () => {
  it("within 15 minutes the last known busy time is used; after that the master gets NO slots, the others stay bookable", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "f1", [{ start: berlin(D.mon, "14:00"), end: berlin(D.mon, "15:00") }]);
    google.accounts.get("f1")!.failWith = "unavailable";

    later(6); // cache older than 5 min -> refresh fails -> 6-minute-old cache still trusted
    let m1 = await times(b, cut, masters[0], D.mon);
    expect(m1).not.toContain("14:00");
    expect(m1).toContain("10:00");

    later(20); // beyond 15 minutes: unconfirmed
    expect(await times(b, cut, masters[0], D.mon)).toEqual([]);
    expect(await times(b, cut, masters[1], D.mon)).toContain("14:00");
    expect(await bookAs(b, cut, masters[0], D.mon, "10:00")).toBe("slot_unavailable");
    const [row] = await w.q<{ status: string; last_error_code: string }>("select status, last_error_code from external_calendar_connections where staff_id=$1", [masters[0]]);
    expect(row).toEqual({ status: "error", last_error_code: "unavailable" });

    // Google recovers: the next refresh after the back-off restores the slots.
    delete google.accounts.get("f1")!.failWith;
    later(22);
    m1 = await times(b, cut, masters[0], D.mon);
    expect(m1).toContain("10:00");
    expect(m1).not.toContain("14:00");
  });

  it("revoked access: the master is unconfirmed until reconnected or disconnected; the token is wiped", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "rv1");
    google.accounts.delete("rv1"); // the person removed ServiceOS in their Google account
    later(6);
    expect(await times(b, cut, masters[0], D.mon)).toEqual([]);
    const [row] = await w.q<{ status: string; refresh_token_ciphertext: string | null }>("select status, refresh_token_ciphertext from external_calendar_connections where staff_id=$1", [masters[0]]);
    expect(row).toEqual({ status: "revoked", refresh_token_ciphertext: null });

    await svc.disconnectExternalCalendar(deps, ownerSession(b), masters[0]);
    expect(await times(b, cut, masters[0], D.mon)).toContain("10:00");
  });

  it("Google not configured at all (no client id): connected masters are unconfirmed, never silently free", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "nc1");
    later(16);
    deps = { ...deps, provider: null };
    expect(await times(b, cut, masters[0], D.mon)).toEqual([]);
    expect(await times(b, cut, masters[1], D.mon)).toContain("10:00");
  });

  it("caching: repeated browsing within 5 minutes does not call Google again", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "c1");
    const before = google.countCalls("getAccessToken");
    for (let i = 0; i < 5; i++) await times(b, cut, null, D.mon);
    expect(google.countCalls("getAccessToken")).toBe(before);
    later(6);
    await Promise.all([times(b, cut, null, D.mon), times(b, cut, null, D.mon), times(b, cut, null, D.mon)]);
    // One refresh for three parallel requests (DB claim), then cached again.
    expect(google.countCalls("getAccessToken")).toBe(before + 1);
  });

  it("the final check before writing demands a fresh answer (commit: 60 s)", async () => {
    const { b, masters, cut } = await salon();
    await connect(b, masters[0], "cm1");
    later(2);
    expect(await times(b, cut, masters[0], D.mon)).toContain("14:00"); // cached, free
    google.accounts.get("cm1")!.calendars[0].busy = [{ start: berlin(D.mon, "14:00"), end: berlin(D.mon, "15:00") }];
    // Browsing still shows the 2-minute-old cache, but the booking itself re-checks Google and is refused.
    expect(await bookAs(b, cut, masters[0], D.mon, "14:00")).toBe("slot_unavailable");
  });
});

describe("isolation and privacy", () => {
  it("one business's connection never affects another business with the same staff names", async () => {
    const a = await salon();
    const other = await salon();
    await connect(a.b, a.masters[0], "iso1", [{ start: berlin(D.mon, "14:00"), end: berlin(D.mon, "15:00") }]);
    expect(await times(other.b, other.cut, other.masters[0], D.mon)).toContain("14:00");
  });

  it("only start/end are stored; the refresh token is encrypted and bound to its row", async () => {
    const { b, masters } = await salon();
    google.accounts.set("priv1", { calendars: [] });
    await connect(b, masters[0], "priv1", [{ start: berlin(D.mon, "14:00"), end: berlin(D.mon, "15:00"), summary: "Therapy", attendees: ["x@y"] } as never]);
    const [row] = await w.q<Record<string, unknown>>("select * from external_calendar_connections where staff_id=$1", [masters[0]]);
    const dump = JSON.stringify(row);
    expect(dump).not.toContain("Therapy");
    expect(dump).not.toContain("attendees");
    expect(dump).not.toContain('"priv1"');
    expect(deps.tokens!.decrypt(row.refresh_token_ciphertext as string, tokenContext(b.ws, masters[0]))).toBe("priv1");
    expect(row.busy_intervals).toEqual([{ start: "2026-10-05T12:00:00.000Z", end: "2026-10-05T13:00:00.000Z" }]);
  });

  it("the owner's overview has status only: no tokens, calendar ids or names", async () => {
    const { b, masters } = await salon();
    await connect(b, masters[0], "ov1", [], [{ id: "secret-calendar@group", name: "Very personal", busy: [] }]);
    const overview = await svc.getExternalCalendarOverview(deps, ownerSession(b));
    expect(overview.connections).toHaveLength(1);
    expect(overview.connections[0]).toMatchObject({ staffId: masters[0], status: "connected", calendarCount: 1 });
    const dump = JSON.stringify(overview);
    for (const s of ["ov1@primary", "Personal", "secret-calendar", "Very personal", "v1."]) expect(dump).not.toContain(s);
  });
});

describe("connect links and OAuth safety", () => {
  it("only owner/admin (or the linked person themself) can create a link; staff role cannot for others", async () => {
    const { b, masters } = await salon();
    const staffUser = await w.member(b, "staff");
    const staffSession = { userId: staffUser, workspaceId: b.ws, role: "staff" as const };
    await expect(svc.createConnectLink(deps, staffSession, masters[0], "https://app.test")).rejects.toMatchObject({ code: "forbidden" });
    await w.q("update staff_profiles set profile_id=$1 where id=$2", [staffUser, masters[1]]);
    await expect(svc.createConnectLink(deps, staffSession, masters[1], "https://app.test")).resolves.toMatchObject({ url: expect.stringMatching(/\/connect-calendar\/[0-9a-f]{64}$/) });
    await expect(svc.getExternalCalendarOverview(deps, staffSession)).resolves.toMatchObject({ managesAll: false, ownStaffId: masters[1] });
    const manager = await w.member(b, "manager");
    await expect(svc.getExternalCalendarOverview(deps, { userId: manager, workspaceId: b.ws, role: "manager" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a staff member of another workspace cannot be targeted", async () => {
    const a = await salon();
    const other = await salon();
    await expect(svc.createConnectLink(deps, ownerSession(a.b), other.masters[0], "https://app.test")).rejects.toMatchObject({ code: "not_found" });
  });

  it("links are single use, expire after 72 h, and only the hash is stored", async () => {
    const { b, masters } = await salon();
    const { url } = await svc.createConnectLink(deps, ownerSession(b), masters[0], "https://app.test");
    const token = url.split("/").pop()!;
    expect(await w.q("select 1 from external_calendar_invites where token_hash=$1", [token])).toHaveLength(0);
    expect(await w.q("select 1 from external_calendar_invites where token_hash=$1", [sha256Hex(token)])).toHaveLength(1);
    expect(await svc.describeConnectLink(deps, token)).toMatchObject({ state: "valid", staffName: "M1" });
    expect(await svc.describeConnectLink(deps, "f".repeat(64))).toEqual({ state: "invalid" });
    expect(await svc.describeConnectLink(deps, "../etc")).toEqual({ state: "invalid" });

    google.accounts.set("once", { calendars: [{ id: "p", name: "P", primary: true, busy: [] }] });
    google.codes.set("code-once", "once");
    const start = await svc.startAuthorization(deps, token, REDIRECT);
    const state = new URL(start.authorizationUrl).searchParams.get("state");
    await svc.completeAuthorization(deps, { flowCookie: start.flowCookie, state, code: "code-once", error: null, redirectUri: REDIRECT });
    expect(await svc.describeConnectLink(deps, token)).toEqual({ state: "used" });
    await expect(svc.startAuthorization(deps, token, REDIRECT)).rejects.toMatchObject({ code: "expired_link" });

    const second = (await svc.createConnectLink(deps, ownerSession(b), masters[1], "https://app.test")).url.split("/").pop()!;
    later(72 * 60 + 1);
    expect(await svc.describeConnectLink(deps, second)).toEqual({ state: "expired" });
  });

  it("OAuth callback: wrong/missing state, a replayed flow and a denied consent are refused", async () => {
    const { b, masters } = await salon();
    google.accounts.set("st1", { calendars: [{ id: "p", name: "P", primary: true, busy: [] }] });
    google.codes.set("code-st1", "st1");
    const token = (await svc.createConnectLink(deps, ownerSession(b), masters[0], "https://app.test")).url.split("/").pop()!;
    const start = await svc.startAuthorization(deps, token, REDIRECT);
    const state = new URL(start.authorizationUrl).searchParams.get("state");

    const base = { flowCookie: start.flowCookie, state, code: "code-st1", error: null, redirectUri: REDIRECT };
    await expect(svc.completeAuthorization(deps, { ...base, state: "0".repeat(64) })).rejects.toMatchObject({ code: "state_mismatch" });
    await expect(svc.completeAuthorization(deps, { ...base, flowCookie: undefined })).rejects.toMatchObject({ code: "state_mismatch" });
    await expect(svc.completeAuthorization(deps, { ...base, code: null, error: "access_denied" })).rejects.toMatchObject({ code: "denied" });
    later(11); // flow cookie lives 10 minutes
    await expect(svc.completeAuthorization(deps, base)).rejects.toMatchObject({ code: "state_mismatch" });
    expect(await w.q("select 1 from external_calendar_connections where staff_id=$1", [masters[0]])).toHaveLength(0);
  });

  it("reconnecting replaces the old grant and revokes it at Google; disconnect revokes and removes everything", async () => {
    const { b, masters } = await salon();
    await connect(b, masters[0], "old-acc");
    await connect(b, masters[0], "new-acc");
    expect(google.revoked).toContain("old-acc");
    expect(await w.q("select 1 from external_calendar_connections where staff_id=$1", [masters[0]])).toHaveLength(1);
    await svc.disconnectExternalCalendar(deps, ownerSession(b), masters[0]);
    expect(google.revoked).toContain("new-acc");
    expect(await w.q("select 1 from external_calendar_connections where staff_id=$1", [masters[0]])).toHaveLength(0);
  });
});

describe("the connecting person can disconnect from the calendar picker", () => {
  it("deletes the connection (token, calendar ids, cache) and revokes at Google; a forged cookie cannot", async () => {
    const { b, masters, cut } = await salon();
    const { setupCookie } = await connect(b, masters[0], "self-off", [{ start: berlin(D.mon, "14:00"), end: berlin(D.mon, "15:00") }]);
    expect(await times(b, cut, masters[0], D.mon)).not.toContain("14:00");
    await expect(svc.disconnectFromSetup(deps, "v1.forged.x.y")).rejects.toMatchObject({ code: "expired_link" });
    await svc.disconnectFromSetup(deps, setupCookie);
    expect(await w.q("select 1 from external_calendar_connections where staff_id=$1", [masters[0]])).toHaveLength(0);
    expect(google.revoked).toContain("self-off");
    expect(await times(b, cut, masters[0], D.mon)).toContain("14:00");
    await expect(svc.disconnectFromSetup(deps, setupCookie)).rejects.toMatchObject({ code: "expired_link" });
  });
});

describe("business calendar: the same rule on create / move / edit", () => {
  it("creating or moving an appointment into Google busy time is refused; editing an existing conflicting appointment is not blocked", async () => {
    const { b, masters, cut } = await salon();
    current = createPgliteSupabaseClient(db, { kind: "user", id: b.owner });
    const session = await getSession(b.slug);
    const [{ id: clientId }] = await w.q<{ id: string }>("insert into clients (workspace_id, name) values ($1, 'Walk-in') returning id", [b.ws]);
    const input = (time: string, staffId = masters[0]) => ({
      client: "Walk-in", clientId, service: "Cut", staff: "M", serviceId: cut, staffId, resourceId: null, date: D.mon, time, durationMinutes: 60,
      price: 40, currency: "EUR", notes: "", visibility: "normal" as const, financialBucket: "main" as const, status: "confirmed" as const, paid: false,
    });
    // Booked BEFORE the person connects Google: later becomes a conflict.
    const existing = await appointments.createAppointment(session, input("14:00"));
    await connect(b, masters[0], "biz1", [{ start: berlin(D.mon, "14:00"), end: berlin(D.mon, "15:00") }, { start: berlin(D.mon, "10:00"), end: berlin(D.mon, "11:00") }]);

    await expect(appointments.createAppointment(session, input("10:00"))).rejects.toMatchObject({ code: "external_calendar_busy" });
    await expect(appointments.createAppointment(session, input("10:00", masters[1]))).resolves.toMatchObject({ time: "10:00" });
    // The existing conflicting appointment stays editable (notes) — ServiceOS never acts on the conflict itself.
    await expect(appointments.updateAppointment(session, existing.id, { notes: "Client confirmed by phone" })).resolves.toMatchObject({ notes: "Client confirmed by phone" });
    // ...but moving it into other Google busy time is refused, and into free time is fine.
    await expect(appointments.moveAppointment(session, { id: existing.id, date: D.mon, time: "10:00" })).rejects.toMatchObject({ code: "external_calendar_busy" });
    await expect(appointments.moveAppointment(session, { id: existing.id, date: D.mon, time: "16:00" })).resolves.toMatchObject({ time: "16:00" });

    // Google unreachable for long: the business cannot book that person blindly either.
    google.accounts.get("biz1")!.failWith = "unavailable";
    later(20);
    await expect(appointments.createAppointment(session, input("12:00"))).rejects.toMatchObject({ code: "external_calendar_unconfirmed" });
  });
});
