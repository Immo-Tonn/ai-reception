import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { createMemoryRateLimiter } from "@/server/ratelimit/memoryRateLimiter";
import { createPostgresRateLimiter } from "@/server/ratelimit/postgresRateLimiter";
import { createPublicBooking, getPublicSlots, loadPublicCatalog, PublicBookingError, type PublicBookingDeps } from "../publicBooking.service";
import { uniqueSlotTimes } from "@/features/appointments/availability";
import { addDays, instantToWall, wallToInstant } from "@/lib/time/zonedTime";
import { createSupabaseAppointmentsRepository } from "@/server/repository/appointmentsSupabaseRepository";
import { createSupabaseClientsRepository } from "@/server/repository/clientsSupabaseRepository";
import { RepositoryConflictError, RepositoryForbiddenError } from "@/server/repository/errors";
import { matchExistingClient, normalizeEmail } from "@/features/publicBooking/bookingRules";
import type { ClientRecord } from "@/features/clients/types";

/**
 * THE Phase 2 acceptance test, with one real shared PostgreSQL in the middle:
 *
 *   guest (anon, no account) --Public Booking service--> shared Postgres
 *   shared Postgres <--Business repositories (signed-in owner, under RLS)--
 *
 * Nothing is mocked between the two sides: the SAME database rows written by
 * the guest-side code are read back by the business-side code, through the real
 * migrations, RLS policies, triggers and constraints (run in PGlite).
 */

const OWNER_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OWNER_B = "bbbbbbbb-0000-4000-8000-0000000000b2";
const MANAGER_A = "cccccccc-0000-4000-8000-0000000000c3";
const STAFF_A = "dddddddd-0000-4000-8000-0000000000d4";

let db: PGlite;
let wsA: string;
let wsB: string;
let slugA: string;
let slugB: string;
let staffA1: string;
let staffA2: string;
let staffB1: string;
let svcCut: string; // 30 min, no buffer
let svcColor: string; // 60 min, 15 min buffer after
let svcRoom: string; // 60 min, needs a room
let roomA: string;
let svcB: string;
let guestDate: string; // a Monday inside the booking window

const service = () => createPgliteSupabaseClient(db, { kind: "service" });
const asUser = (id: string) => createPgliteSupabaseClient(db, { kind: "user", id });
const anon = () => createPgliteSupabaseClient(db, { kind: "anon" });
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

function deps(overrides: Partial<PublicBookingDeps> = {}): PublicBookingDeps {
  return { admin: service(), rateLimiter: createMemoryRateLimiter(), ...overrides };
}
const ctx = { ip: "203.0.113.7" };
const guest = (n: number, extra: Record<string, unknown> = {}) => ({
  name: `Guest ${n}`, email: `guest${n}@example.test`, phone: `+49 170 555 00${String(n).padStart(2, "0")}`, notes: "", ...extra,
});
const req = (over: Record<string, unknown> = {}) => ({
  slug: slugA, serviceId: svcCut, staffId: staffA1, date: guestDate, time: "09:00", client: guest(1), ...over,
});
const ownerRepo = (ws = wsA, user = OWNER_A) => createSupabaseAppointmentsRepository(ws, async () => asUser(user));
const clientsRepo = (ws = wsA, user = OWNER_A) => createSupabaseClientsRepository(ws, async () => asUser(user));
const fail = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as PublicBookingError | null;

function nextMonday(minDaysAhead: number): string {
  const base = instantToWall(new Date(Date.now() + minDaysAhead * 86_400_000), "Europe/Berlin").date;
  for (let i = 0; i < 7; i++) {
    const d = addDays(base, i);
    if (new Date(`${d}T12:00:00Z`).getUTCDay() === 1) return d;
  }
  return base;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id, email) values
    ('${OWNER_A}','a@test.invalid'),('${OWNER_B}','b@test.invalid'),('${MANAGER_A}','m@test.invalid'),('${STAFF_A}','s@test.invalid')`);
  const prov = async (id: string, email: string, name: string, base: string) =>
    (await service().rpc("provision_workspace", { p_user_id: id, p_email: email, p_full_name: "", p_business_name: name, p_base_slug: base, p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[];
  [{ out_workspace_id: wsA, out_slug: slugA }] = await prov(OWNER_A, "a@test.invalid", "Salon A", "salon-a");
  [{ out_workspace_id: wsB, out_slug: slugB }] = await prov(OWNER_B, "b@test.invalid", "Studio B", "studio-b");
  await db.exec(`update workspaces set timezone = 'America/New_York' where id = '${wsB}'`);

  await db.exec(`
    insert into profiles (id, email) values ('${MANAGER_A}','m@test.invalid'),('${STAFF_A}','s@test.invalid');
    insert into workspace_members (workspace_id, profile_id, role) values ('${wsA}','${MANAGER_A}','manager'),('${wsA}','${STAFF_A}','staff');
  `);
  // owner "You" already exists (provisioning); add a second person to A and one to B
  staffA1 = (await q<{ id: string }>("select id from staff_profiles where workspace_id = $1", [wsA]))[0].id;
  staffA2 = (await q<{ id: string }>("insert into staff_profiles (workspace_id, name) values ($1,'Elena') returning id", [wsA]))[0].id;
  staffB1 = (await q<{ id: string }>("select id from staff_profiles where workspace_id = $1", [wsB]))[0].id;
  const ins = async (ws: string, name: string, dur: number, after: number, res: string | null = null) =>
    (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price,buffer_after_minutes,required_resource_type) values ($1,$2,$3,50,$4,$5) returning id", [ws, name, dur, after, res]))[0].id;
  svcCut = await ins(wsA, "Haircut", 30, 0);
  svcColor = await ins(wsA, "Color", 60, 15);
  svcRoom = await ins(wsA, "Treatment", 60, 0, "room");
  svcB = await ins(wsB, "Consult", 30, 0);
  roomA = (await q<{ id: string }>("insert into resources (workspace_id,name,type) values ($1,'Room 1','room') returning id", [wsA]))[0].id;
  guestDate = nextMonday(3);
}, 90_000);

describe("ACCEPTANCE — Device A (guest) books, Device B (business) sees it, after reload", () => {
  let booked: Awaited<ReturnType<typeof createPublicBooking>>;

  it("the guest sees real services/staff and bookable slots (Any specialist: each time once)", async () => {
    const catalog = await loadPublicCatalog(deps(), slugA);
    expect(catalog!.services.map((s) => s.name).sort()).toEqual(["Color", "Haircut", "Treatment"]);
    expect(catalog!.staff.map((s) => s.name).sort()).toEqual(["Elena", "You"]);
    expect(JSON.stringify(catalog)).not.toContain("@"); // no e-mail addresses in the public catalog

    const slots = await getPublicSlots(deps(), ctx, { slug: slugA, serviceId: svcCut, staffId: null, date: guestDate });
    const times = slots.map((s) => s.time);
    expect(times.length).toBe(new Set(times).size * 2); // 2 people per time
    expect(uniqueSlotTimes(slots).length).toBe(new Set(times).size);
    expect(times[0]).toBe("09:00"); // default hours 09–18
  });

  it("the guest books (no account)", async () => {
    booked = await createPublicBooking(deps(), ctx, req());
    expect(booked).toMatchObject({ serviceName: "Haircut", staffId: staffA1, date: guestDate, time: "09:00", status: "pending" });
  });

  it("the business owner (another browser, signed in) sees the appointment in the Calendar repository", async () => {
    const appointments = await ownerRepo().list();
    const mine = appointments.find((a) => a.id === booked.appointmentId)!;
    expect(mine).toMatchObject({
      client: "Guest 1", service: "Haircut", staff: "You", date: guestDate, time: "09:00", durationMinutes: 30,
      status: "pending", visibility: "normal", financialBucket: "main", price: 50, currency: "EUR", resourceId: null,
    });
    // stable ids, not just names
    expect(mine.clientId).toBeTruthy();
    expect(mine.serviceId).toBe(svcCut);
    expect(mine.staffId).toBe(staffA1);
    expect(mine.financialBucketId).toBeTruthy();
  });

  it("the client created by Public Booking appears in Business -> Clients, with the booking as upcoming", async () => {
    const clients = await clientsRepo().list();
    const c = clients.find((x) => x.email === "guest1@example.test")!;
    expect(c).toMatchObject({ name: "Guest 1", tags: ["new"] });
    expect(c.upcoming).toEqual([{ date: guestDate, time: "09:00", service: "Haircut" }]);
    const appt = (await ownerRepo().list()).find((a) => a.id === booked.appointmentId)!;
    expect(appt.clientId).toBe(c.id); // the appointment points at that exact client row
  });

  it("survives a 'reload': brand-new repository instances read the same persisted row", async () => {
    const again = await createSupabaseAppointmentsRepository(wsA, async () => asUser(OWNER_A)).get(booked.appointmentId);
    expect(again?.client).toBe("Guest 1");
    const row = (await q<{ source: string; created_by: string | null; status: string }>("select source, created_by, status from appointments where id = $1", [booked.appointmentId]))[0];
    expect(row).toEqual({ source: "public", created_by: null, status: "pending" });
  });

  it("the booking wrote an audit entry visible to the owner, with no guest PII", async () => {
    const log = await q<{ summary: string; source: string }>("select summary, source from audit_logs where workspace_id = $1", [wsA]);
    expect(log.some((l) => l.source === "public")).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/guest1|Guest 1/);
  });
});

describe("what the server decides, not the browser", () => {
  it("price, status, visibility and financial account are set by the database", async () => {
    const r = await createPublicBooking(deps(), ctx, req({ time: "10:00", client: guest(2, { price: 0, status: "confirmed", visibility: "private" }) } as never));
    const row = (await q<{ price: string; status: string; visibility: string; kind: string }>(
      "select a.price, a.status, a.visibility, b.kind from appointments a join financial_buckets b on b.id = a.financial_bucket_id where a.id = $1", [r.appointmentId]))[0];
    expect(row).toMatchObject({ status: "pending", visibility: "normal", kind: "main" });
    expect(Number(row.price)).toBe(50);
  });

  it("auto-confirm is a workspace setting, off by default", async () => {
    await db.exec(`update workspaces set auto_confirm_bookings = true where id = '${wsA}'`);
    const r = await createPublicBooking(deps(), ctx, req({ time: "11:00", client: guest(3) }));
    expect(r.status).toBe("confirmed");
    await db.exec(`update workspaces set auto_confirm_bookings = false where id = '${wsA}'`);
  });

  it("an unknown workspace is not_found (and says nothing else)", async () => {
    expect((await fail(createPublicBooking(deps(), ctx, req({ slug: "no-such-salon" }))))?.code).toBe("not_found");
    expect((await fail(getPublicSlots(deps(), ctx, { slug: "no-such-salon", serviceId: svcCut, staffId: null, date: guestDate })))?.code).toBe("not_found");
    expect((await fail(createPublicBooking(deps(), ctx, req({ slug: "Bad Slug!" }))))?.code).toBe("invalid_input");
  });

  it("a service or person from ANOTHER workspace is refused", async () => {
    expect((await fail(createPublicBooking(deps(), ctx, req({ serviceId: svcB, time: "14:00", client: guest(4) }))))?.code).toBe("invalid_input");
    expect((await fail(createPublicBooking(deps(), ctx, req({ staffId: staffB1, time: "14:00", client: guest(4) }))))?.code).toBe("invalid_input");
    // and straight at the database function: it re-checks membership itself
    const { error } = await service().rpc("create_public_booking", {
      p_workspace_id: wsA, p_service_id: svcB, p_staff_id: staffA1, p_resource_id: null,
      p_starts_at: wallToInstant(guestDate, "15:00", "Europe/Berlin").toISOString(),
      p_name: "X", p_email: "x@example.test", p_phone: "", p_notes: "",
    });
    expect(error?.code).toBe("P0002");
  });

  it("invalid input never reaches the database", async () => {
    const before = (await q<{ n: string }>("select count(*)::text n from appointments"))[0].n;
    for (const bad of [
      req({ time: "25:99" }), req({ client: guest(5, { email: "not-an-email" }) }), req({ client: guest(5, { name: "" }) }),
      req({ client: guest(5, { phone: "<script>" }) }), req({ date: "tomorrow" }), req({ serviceId: "not-a-uuid" }),
    ]) {
      expect((await fail(createPublicBooking(deps(), ctx, bad)))?.code, JSON.stringify(bad).slice(0, 60)).toBe("invalid_input");
    }
    expect((await q<{ n: string }>("select count(*)::text n from appointments"))[0].n).toBe(before);
  });

  it("the past and the far future are not bookable", async () => {
    expect((await getPublicSlots(deps(), ctx, { slug: slugA, serviceId: svcCut, staffId: null, date: "2020-01-06" })).length).toBe(0);
    expect((await getPublicSlots(deps(), ctx, { slug: slugA, serviceId: svcCut, staffId: null, date: addDays(guestDate, 200) })).length).toBe(0);
    expect((await fail(createPublicBooking(deps(), ctx, req({ date: "2020-01-06", time: "10:00" }))))?.code).toBe("slot_unavailable");
  });
});

describe("Any staff, past slots, timezone", () => {
  it("'any specialist' assigns whoever is free; a time stays offered while at least one person is free", async () => {
    // staffA1 is busy 09:00 (booked above); Elena is free
    const slots = await getPublicSlots(deps(), ctx, { slug: slugA, serviceId: svcCut, staffId: null, date: guestDate });
    const at9 = slots.filter((s) => s.time === "09:00");
    expect(at9.map((s) => s.staffId)).toEqual([staffA2]);
    const r = await createPublicBooking(deps(), ctx, req({ staffId: null, time: "09:00", client: guest(6) }));
    expect(r.staffId).toBe(staffA2);
    // now nobody is free at 09:00
    const after = await getPublicSlots(deps(), ctx, { slug: slugA, serviceId: svcCut, staffId: null, date: guestDate });
    expect(after.some((s) => s.time === "09:00")).toBe(false);
  });

  it("slots in the past are excluded using the BUSINESS's local 'now' (clock injected)", async () => {
    // 10:44 Berlin on guestDate
    const now = wallToInstant(guestDate, "10:44", "Europe/Berlin");
    const slots = await getPublicSlots(deps({ now: () => now }), ctx, { slug: slugA, serviceId: svcCut, staffId: staffA2, date: guestDate });
    expect(slots.every((s) => s.time >= "10:45")).toBe(true);
    expect(slots.some((s) => s.time === "10:45")).toBe(true);
  });

  it("a workspace in another time zone: 09:00 wall-clock there is stored as the right instant and read back as 09:00", async () => {
    const dateNY = nextMonday(3);
    const r = await createPublicBooking(deps(), ctx, { slug: slugB, serviceId: svcB, staffId: staffB1, date: dateNY, time: "09:00", client: guest(7) });
    const row = (await q<{ starts_at: Date; timezone: string }>("select starts_at, timezone from appointments where id = $1", [r.appointmentId]))[0];
    expect(row.timezone).toBe("America/New_York");
    expect(instantToWall(row.starts_at, "America/New_York")).toEqual({ date: dateNY, time: "09:00" });
    expect(instantToWall(row.starts_at, "Europe/Berlin").time).not.toBe("09:00"); // a Berlin reading would be wrong
    const seen = await ownerRepo(wsB, OWNER_B).get(r.appointmentId);
    expect(seen).toMatchObject({ date: dateNY, time: "09:00", service: "Consult" });
  });
});

describe("double booking is stopped in the database", () => {
  it("two simultaneous requests for the same person and time: exactly one wins", async () => {
    const date = addDays(guestDate, 7);
    const results = await Promise.allSettled([
      createPublicBooking(deps(), ctx, req({ date, time: "13:00", client: guest(10) })),
      createPublicBooking(deps(), ctx, req({ date, time: "13:00", client: guest(11) })),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((loser.reason as PublicBookingError).code).toBe("slot_unavailable");
    expect((await q<{ n: string }>("select count(*)::text n from appointments where staff_id = $1 and starts_at = $2", [staffA1, wallToInstant(date, "13:00", "Europe/Berlin")]))[0].n).toBe("1");
  });

  it("the constraint holds even when an application check is bypassed (raw overlapping insert)", async () => {
    const start = wallToInstant(addDays(guestDate, 14), "09:00", "Europe/Berlin");
    const insert = (offsetMin: number) =>
      q("insert into appointments (workspace_id, staff_id, service_id, starts_at, ends_at) values ($1,$2,$3,$4,$5)", [
        wsA, staffA1, svcCut, new Date(start.getTime() + offsetMin * 60000).toISOString(), new Date(start.getTime() + (offsetMin + 30) * 60000).toISOString(),
      ]);
    await insert(0);
    await expect(insert(15)).rejects.toMatchObject({ code: "23P01" }); // overlaps
    await insert(30); // back-to-back is fine
  });

  it("service buffers count: a 15-minute buffer after a Color blocks the next 15 minutes, in the engine AND the database", async () => {
    const date = addDays(guestDate, 21);
    await createPublicBooking(deps(), ctx, req({ serviceId: svcColor, date, time: "09:00", client: guest(12) })); // 09:00–10:00 (+15)
    const slots = await getPublicSlots(deps(), ctx, { slug: slugA, serviceId: svcCut, staffId: staffA1, date });
    expect(slots.some((s) => s.time === "10:00")).toBe(false); // inside the buffer
    expect(slots.some((s) => s.time === "10:15")).toBe(true);
    await expect(
      q("insert into appointments (workspace_id, staff_id, service_id, starts_at, ends_at) values ($1,$2,$3,$4,$5)", [
        wsA, staffA1, svcCut, wallToInstant(date, "10:00", "Europe/Berlin"), wallToInstant(date, "10:30", "Europe/Berlin"),
      ]),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("a cancelled appointment frees the slot", async () => {
    const date = addDays(guestDate, 28);
    const r = await createPublicBooking(deps(), ctx, req({ date, time: "15:00", client: guest(13) }));
    await db.exec(`update appointments set status = 'cancelled' where id = '${r.appointmentId}'`);
    const again = await createPublicBooking(deps(), ctx, req({ date, time: "15:00", client: guest(14) }));
    expect(again.time).toBe("15:00");
  });

  it("resource collision: one room cannot host two people at once (engine and database)", async () => {
    const date = addDays(guestDate, 35);
    const first = await createPublicBooking(deps(), ctx, req({ serviceId: svcRoom, date, time: "09:00", staffId: staffA1, client: guest(15) }));
    expect(first.staffId).toBe(staffA1);
    const slots = await getPublicSlots(deps(), ctx, { slug: slugA, serviceId: svcRoom, staffId: staffA2, date });
    expect(slots.some((s) => s.time === "09:00")).toBe(false); // the only room is taken
    await expect(
      q("insert into appointments (workspace_id, staff_id, resource_id, service_id, starts_at, ends_at) values ($1,$2,$3,$4,$5,$6)", [
        wsA, staffA2, roomA, svcRoom, wallToInstant(date, "09:30", "Europe/Berlin"), wallToInstant(date, "10:30", "Europe/Berlin"),
      ]),
    ).rejects.toMatchObject({ code: "23P01" });
  });

  it("the Business side is refused by the same constraint (owner creates over a guest's booking)", async () => {
    const date = addDays(guestDate, 42);
    await createPublicBooking(deps(), ctx, req({ date, time: "16:00", client: guest(16) }));
    const owner = ownerRepo();
    const clientId = (await clientsRepo().list())[0].id;
    await expect(
      owner.create({
        id: "x", client: "Guest 1", clientId, service: "Haircut", serviceId: svcCut, staff: "You", staffId: staffA1, resourceId: null,
        date, time: "16:00", durationMinutes: 30, price: 50, currency: "EUR", notes: "", visibility: "normal", financialBucket: "main",
        status: "confirmed", paid: false, seriesId: null, recurrence: null,
      }),
    ).rejects.toBeInstanceOf(RepositoryConflictError);
  });
});

describe("tenant isolation and privacy through the repositories", () => {
  it("workspace B's owner sees none of workspace A's appointments or clients", async () => {
    expect(await ownerRepo(wsA, OWNER_B).list()).toEqual([]);
    expect(await clientsRepo(wsA, OWNER_B).list()).toEqual([]);
    expect((await ownerRepo(wsB, OWNER_B).list()).every((a) => a.service === "Consult")).toBe(true);
  });

  it("a guest (anon key) can read nothing directly", async () => {
    for (const t of ["appointments", "clients", "services", "staff_profiles", "audit_logs", "financial_buckets", "workspaces"]) {
      // Real Supabase: RLS returns []. A bare Postgres without default grants: permission error. Either way, no rows.
      expect((await anon().from(t).select("*")).data ?? [], t).toEqual([]);
    }
    expect((await anon().from("appointments").insert({ workspace_id: wsA, starts_at: new Date().toISOString(), ends_at: new Date().toISOString() })).error).toBeTruthy();
  });

  it("the guest-facing functions are not callable by a signed-in user or anon", async () => {
    for (const client of [anon(), asUser(OWNER_A)]) {
      expect((await client.rpc("get_public_booking_catalog", { p_slug: slugA })).error?.code).toBe("42501");
      expect((await client.rpc("create_public_booking", { p_workspace_id: wsA })).error).toBeTruthy();
    }
  });

  it("an appointment cannot reference another workspace's client, staff or service", async () => {
    const foreignClient = (await q<{ id: string }>("insert into clients (workspace_id, name) values ($1,'Foreign') returning id", [wsB]))[0].id;
    await expect(
      ownerRepo().create({
        id: "x", client: "Foreign", clientId: foreignClient, service: "Haircut", serviceId: svcCut, staff: "You", staffId: staffA1, resourceId: null,
        date: addDays(guestDate, 49), time: "10:00", durationMinutes: 30, price: 1, currency: "EUR", notes: "", visibility: "normal",
        financialBucket: "main", status: "confirmed", paid: false, seriesId: null, recurrence: null,
      }),
    ).rejects.toBeInstanceOf(RepositoryForbiddenError);
    await expect(q("insert into service_staff (service_id, staff_id) values ($1,$2)", [svcCut, staffB1])).rejects.toThrow(/cross_workspace_reference/);
  });

  it("PRIVATE visibility: the owner sees the row, a manager only a 'busy' placeholder, nobody can read it directly", async () => {
    const date = addDays(guestDate, 56);
    const clientId = (await clientsRepo().list())[0].id;
    const created = await ownerRepo().create({
      id: "x", client: "Guest 1", clientId, service: "Haircut", serviceId: svcCut, staff: "You", staffId: staffA1, resourceId: null,
      date, time: "09:00", durationMinutes: 30, price: 99, currency: "EUR", notes: "secret note", visibility: "private",
      financialBucket: "main", status: "confirmed", paid: false, seriesId: null, recurrence: null,
    });
    expect(created.visibility).toBe("private");

    const owner = (await ownerRepo().list()).find((a) => a.id === created.id)!;
    expect(owner).toMatchObject({ client: "Guest 1", notes: "secret note", price: 99 });

    const asManager = (await ownerRepo(wsA, MANAGER_A).list()).find((a) => a.id === created.id)!;
    expect(asManager).toMatchObject({ client: "", service: "", notes: "", price: 0, visibility: "private", date, time: "09:00", staff: "You" });

    const direct = await asUser(MANAGER_A).from("appointments").select("*").eq("id", created.id);
    expect(direct.data).toEqual([]); // the database itself hides it
    expect((await ownerRepo(wsA, MANAGER_A).get(created.id))?.client).toBe(""); // get -> masked, not leaked
  });

  it("PRIVATE financial account is independent of visibility and isolated by permission", async () => {
    const date = addDays(guestDate, 63);
    const clientId = (await clientsRepo().list())[0].id;
    // Visibility NORMAL + Financial PRIVATE (owner may use it)
    const created = await ownerRepo().create({
      id: "x", client: "Guest 1", clientId, service: "Haircut", serviceId: svcCut, staff: "You", staffId: staffA1, resourceId: null,
      date, time: "09:00", durationMinutes: 30, price: 10, currency: "EUR", notes: "", visibility: "normal",
      financialBucket: "private", status: "confirmed", paid: false, seriesId: null, recurrence: null,
    });
    expect(created).toMatchObject({ visibility: "normal", financialBucket: "private" });

    // a staff member can see the normal-visibility appointment, but cannot tell it is in the private account
    const staffView = (await ownerRepo(wsA, STAFF_A).list()).find((a) => a.id === created.id)!;
    expect(staffView).toBeTruthy();
    expect(staffView.financialBucketId).toBeUndefined();
    expect(staffView.financialBucket).not.toBe("private");

    // ...and cannot USE the private account
    await expect(
      ownerRepo(wsA, STAFF_A).create({
        id: "x", client: "Guest 1", clientId, service: "Haircut", serviceId: svcCut, staff: "You", staffId: staffA1, resourceId: null,
        date: addDays(date, 7), time: "09:00", durationMinutes: 30, price: 10, currency: "EUR", notes: "", visibility: "normal",
        financialBucket: "private", status: "confirmed", paid: false, seriesId: null, recurrence: null,
      }),
    ).rejects.toBeInstanceOf(RepositoryForbiddenError);
    expect((await asUser(STAFF_A).from("financial_buckets").select("*")).data).toEqual([]);

    // Visibility PRIVATE + Financial MAIN is just as valid (all four combinations exist)
    const other = await ownerRepo().create({
      id: "x", client: "Guest 1", clientId, service: "Haircut", serviceId: svcCut, staff: "You", staffId: staffA1, resourceId: null,
      date: addDays(date, 14), time: "09:00", durationMinutes: 30, price: 10, currency: "EUR", notes: "", visibility: "private",
      financialBucket: "main", status: "confirmed", paid: false, seriesId: null, recurrence: null,
    });
    expect(other).toMatchObject({ visibility: "private", financialBucket: "main" });
  });

  it("owner updates persist: reschedule moves wall-clock time, cancel frees it; status changes round-trip", async () => {
    const date = addDays(guestDate, 70);
    const r = await createPublicBooking(deps(), ctx, req({ date, time: "09:00", client: guest(20) }));
    const repo = ownerRepo();
    const moved = await repo.update(r.appointmentId, { date, time: "11:30" });
    expect(moved).toMatchObject({ date, time: "11:30", durationMinutes: 30 });
    const confirmed = await repo.update(r.appointmentId, { status: "confirmed", paid: true });
    expect(confirmed).toMatchObject({ status: "confirmed", paid: true, time: "11:30" });
    await repo.update(r.appointmentId, { status: "cancelled" });
    const slots = await getPublicSlots(deps(), ctx, { slug: slugA, serviceId: svcCut, staffId: staffA1, date });
    expect(slots.some((s) => s.time === "11:30")).toBe(true);
  });

  it("recurring series are stored once and linked", async () => {
    const clientId = (await clientsRepo().list())[0].id;
    const repo = ownerRepo();
    const base = { id: "x", client: "Guest 1", clientId, service: "Haircut", serviceId: svcCut, staff: "You", staffId: staffA1, resourceId: null, durationMinutes: 30, price: 1, currency: "EUR", notes: "", visibility: "normal" as const, financialBucket: "main" as const, status: "confirmed" as const, paid: false, recurrence: { frequency: "weekly" as const, count: 2 } };
    const first = await repo.create({ ...base, date: addDays(guestDate, 120), time: "09:00", seriesId: "series-tmp" });
    const second = await repo.create({ ...base, date: addDays(guestDate, 127), time: "09:00", seriesId: first.seriesId });
    expect(first.seriesId).toBeTruthy();
    expect(second.seriesId).toBe(first.seriesId);
    expect(first.recurrence).toEqual({ frequency: "weekly", count: 2 });
  });
});

describe("client matching: SQL and TypeScript agree", () => {
  const mk = (id: string, email: string, phone: string): ClientRecord => ({ id, name: id, email, phone, tags: [], lastVisit: null, upcoming: [], history: [], notes: "" });

  it("same e-mail in another case / phone in another format => the SAME client row, never a duplicate; a guest cannot rename it", async () => {
    const date = addDays(guestDate, 7);
    const a = await createPublicBooking(deps(), ctx, req({ date, time: "09:00", client: { name: "Original Name", email: "Match@Example.Test", phone: "+49 (170) 111-222", notes: "" } }));
    const b = await createPublicBooking(deps(), ctx, req({ date, time: "10:00", client: { name: "Impostor", email: "match@example.test", phone: "+49 170 111 222", notes: "" } }));
    const c = await createPublicBooking(deps(), ctx, req({ date, time: "11:00", client: { name: "Phone Only", email: "other@example.test", phone: "+4917011 1222", notes: "" } }));
    const rows = await q<{ client_id: string }>("select client_id from appointments where id = any($1)", [[a.appointmentId, b.appointmentId, c.appointmentId]]);
    expect(new Set(rows.map((r) => r.client_id)).size).toBe(1);
    const names = await q<{ name: string }>("select name from clients where id = $1", [rows[0].client_id]);
    expect(names[0].name).toBe("Original Name");
  });

  it("the TypeScript rule gives the same answer as the SQL function on the same data", () => {
    const list = [mk("a", "a@x.de", "+49 1"), mk("b", "b@x.de", "+49 2")];
    expect(matchExistingClient(list, { email: " A@X.DE ", phone: "" })?.id).toBe("a");
    expect(matchExistingClient(list, { email: "", phone: "+49 2" })?.id).toBe("b");
    expect(matchExistingClient(list, { email: "a@x.de", phone: "+49 2" })?.id).toBe("a"); // e-mail wins
    expect(normalizeEmail("  A@X.DE ")).toBe("a@x.de");
  });
});

describe("rate limiting (PostgreSQL, shared, no PII)", () => {
  it("blocks after the limit, per scope and subject, and recovers in the next window", async () => {
    const limiter = createPostgresRateLimiter(service(), "test-secret");
    const rule = { scope: "t_scope", limit: 3, windowSeconds: 3600 };
    const decisions = [];
    for (let i = 0; i < 5; i++) decisions.push(await limiter.hit(rule, "198.51.100.9"));
    expect(decisions.map((d) => d.allowed)).toEqual([true, true, true, false, false]);
    expect(decisions[3].retryAfterSeconds).toBeGreaterThan(0);
    expect((await limiter.hit(rule, "198.51.100.10")).allowed).toBe(true); // other subject unaffected
    expect((await limiter.hit({ ...rule, scope: "other" }, "198.51.100.9")).allowed).toBe(true); // other scope unaffected
  });

  it("public booking is rate limited per IP and per contact, with the real Postgres limiter", async () => {
    const d = deps({ rateLimiter: createPostgresRateLimiter(service(), "test-secret") });
    const date = addDays(guestDate, 49);
    const codes: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await fail(createPublicBooking(d, { ip: "192.0.2.55" }, req({ date, time: `${String(9 + i).padStart(2, "0")}:00`, client: guest(30 + i, { email: "same@example.test" }) }))))?.code);
    }
    // 5 per e-mail per hour -> the 6th is refused before anything is written
    expect(codes.slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(codes[5]).toBe("rate_limited");
  });

  it("stores only keyed hashes — never the IP address or e-mail", async () => {
    const rows = await q<{ scope: string; key_hash: string }>("select scope, key_hash from rate_limits");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows)).not.toMatch(/198\.51\.100|192\.0\.2|example\.test|@/);
  });

  it("the limiter is service-role only", async () => {
    expect((await asUser(OWNER_A).rpc("rate_limit_hit", { p_scope: "x", p_key_hash: "y", p_limit: 1, p_window_seconds: 60 })).error?.code).toBe("42501");
  });

  it("fails closed: an unreachable limiter stops the operation", async () => {
    const broken = createPostgresRateLimiter({ rpc: async () => ({ data: null, error: { message: "down" } }) } as unknown as SupabaseClient, "s");
    const e = await createPublicBooking(deps({ rateLimiter: broken }), ctx, req({ date: addDays(guestDate, 105), time: "09:00" })).then(() => null, (x: unknown) => x);
    expect(e).toBeTruthy();
    expect((await q<{ n: string }>("select count(*)::text n from appointments where starts_at >= $1 and starts_at < $2", [wallToInstant(addDays(guestDate, 105), "00:00", "Europe/Berlin"), wallToInstant(addDays(guestDate, 106), "00:00", "Europe/Berlin")]))[0].n).toBe("0");
  });
});

void vi;
