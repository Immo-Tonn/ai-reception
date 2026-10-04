import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { createMemoryRateLimiter } from "@/server/ratelimit/memoryRateLimiter";
import { createPublicBooking, getPublicSlots } from "@/server/booking/publicBooking.service";
import { addDays } from "@/lib/time/zonedTime";
import {
  cancelMyBooking,
  claimBooking,
  ensureClientAccount,
  getRescheduleSlots,
  issueBookingClaim,
  listMyBookings,
  mapBookingRow,
  rescheduleMyBooking,
  type ClientAccountDeps,
} from "../clientAccount.service";

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const C1 = "11111111-0000-4000-8000-000000000001";
const C2 = "22222222-0000-4000-8000-000000000002";

let db: PGlite;
let slug: string;
let wsId: string;
let staffId: string;
let svcId: string;
let svcBufId: string;
let monday: string;

const admin = () => createPgliteSupabaseClient(db, { kind: "service" });
const deps = (over: Partial<ClientAccountDeps> = {}): ClientAccountDeps => ({ admin: admin(), rateLimiter: createMemoryRateLimiter(), ...over });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

function nextMonday() {
  const d0 = new Date(Date.now() + 3 * 86_400_000);
  for (let i = 0; i < 7; i++) {
    const t = new Date(d0.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 1) return t.toISOString().slice(0, 10);
  }
  throw new Error("unreachable");
}

let n = 0;
async function guestBook(date: string, time: string, serviceId = svcId) {
  const d = { admin: admin(), rateLimiter: createMemoryRateLimiter() };
  const r = await createPublicBooking(d, { ip: "t" }, {
    slug, serviceId, staffId, date, time,
    client: { name: "Guest", email: `guest${n++}@example.test`, phone: "+49 170 000 000", notes: "" },
  });
  return r.appointmentId;
}
/** Guest booking + claim by `user`, exactly like the real flow. */
async function bookAndClaim(user: string, date: string, time: string, serviceId = svcId) {
  const id = await guestBook(date, time, serviceId);
  const token = (await issueBookingClaim(deps(), id))!;
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  await claimBooking(deps(), user, token);
  return { id, token };
}
const publicTimes = async (date: string) =>
  (await getPublicSlots({ admin: admin(), rateLimiter: createMemoryRateLimiter() }, { ip: "t" }, { slug, serviceId: svcId, staffId, date })).map((s) => s.time);

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@test.invalid'),('${C1}','c1@test.invalid'),('${C2}','c2@test.invalid')`);
  const r = (await admin().rpc("provision_workspace", { p_user_id: OWNER, p_email: "o@test.invalid", p_full_name: "", p_business_name: "Biz", p_base_slug: "biz-salon", p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[];
  wsId = r[0].out_workspace_id;
  slug = r[0].out_slug;
  staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
  svcId = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Haircut',30,40) returning id", [wsId]))[0].id;
  svcBufId = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price,buffer_before_minutes,buffer_after_minutes) values ($1,'Colour',30,80,10,15) returning id", [wsId]))[0].id;
  monday = nextMonday();
}, 90_000);
afterAll(async () => db.close());

describe("claim + list", () => {
  it("claim then list: the booking appears with customer fields in the business timezone", async () => {
    expect(await listMyBookings(deps(), C1)).toEqual([]);
    const { id } = await bookAndClaim(C1, monday, "10:00");
    const list = await listMyBookings(deps(), C1);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id, workspaceSlug: slug, businessName: "Biz", date: monday, time: "10:00", endTime: "10:30",
      status: "pending", serviceName: "Haircut", isUpcoming: true, canCancel: true, canReschedule: true, price: 40,
    });
    expect(list[0].timezone).toBeTruthy();
  });

  it("claiming is idempotent for the same user; a bad token is not_found; another user's token is not_manageable", async () => {
    const { token } = await bookAndClaim(C1, monday, "12:00");
    await expect(claimBooking(deps(), C1, token)).resolves.toBeTruthy();
    await expect(claimBooking(deps(), C2, token)).rejects.toMatchObject({ code: "not_manageable" });
    await expect(claimBooking(deps(), C2, "0".repeat(64))).rejects.toMatchObject({ code: "not_found" });
    expect(await listMyBookings(deps(), C2)).toEqual([]);
  });

  it("claim is rate limited", async () => {
    const denied = { hit: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 7 }) };
    await expect(claimBooking(deps({ rateLimiter: denied }), C1, "a".repeat(64))).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 7 });
  });
});

describe("ownership (service layer)", () => {
  it("Client B cannot list, cancel, read slots for or reschedule Client A's booking", async () => {
    const { id } = await bookAndClaim(C1, monday, "15:00");
    expect((await listMyBookings(deps(), C2)).map((b) => b.id)).not.toContain(id);
    await expect(cancelMyBooking(deps(), C2, id)).rejects.toMatchObject({ code: "not_found" });
    await expect(getRescheduleSlots(deps(), C2, id, monday)).rejects.toMatchObject({ code: "not_found" });
    await expect(rescheduleMyBooking(deps(), C2, id, monday, "16:00", staffId)).rejects.toMatchObject({ code: "not_found" });
    expect((await q<{ status: string }>("select status::text from appointments where id=$1", [id]))[0].status).toBe("pending");
    // even straight at the database function
    const direct = await admin().rpc("cancel_my_booking", { p_user_id: C2, p_appointment_id: id });
    expect(direct.error?.code).toBe("P0002");
  });

  it("garbage ids are invalid_input, not a database error", async () => {
    await expect(cancelMyBooking(deps(), C1, "not-a-uuid")).rejects.toMatchObject({ code: "invalid_input" });
    await expect(listMyBookings(deps(), "nope")).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("reschedule", () => {
  it("moves onto a really free slot; the business sees it (same row) and the old time frees up", async () => {
    const date = addDays(monday, 14);
    const { id } = await bookAndClaim(C1, date, "09:00");
    const slots = await getRescheduleSlots(deps(), C1, id, date);
    expect(slots.some((s) => s.time === "13:00")).toBe(true);
    await rescheduleMyBooking(deps(), C1, id, date, "13:00", staffId);
    const mine = (await listMyBookings(deps(), C1)).find((b) => b.id === id)!;
    expect(mine).toMatchObject({ date, time: "13:00" });
    const row = (await q<{ starts_at: Date }>("select starts_at from appointments where id=$1", [id]))[0];
    expect(new Date(row.starts_at).toISOString()).toBe(mine.startsAt);
    expect(await publicTimes(date)).toContain("09:00");
    expect(await publicTimes(date)).not.toContain("13:00");
    expect((await q<{ action: string }>("select action from audit_logs where entity_id=$1 and source='public'", [id])).map((r) => r.action)).toContain("moved");
  });

  it("moving within its own window works (guest availability would refuse it)", async () => {
    const date = addDays(monday, 21);
    const { id } = await bookAndClaim(C1, date, "10:00");
    expect(await publicTimes(date)).not.toContain("10:15");
    expect((await getRescheduleSlots(deps(), C1, id, date)).some((s) => s.time === "10:15")).toBe(true);
    await rescheduleMyBooking(deps(), C1, id, date, "10:15", staffId);
    expect((await listMyBookings(deps(), C1)).find((b) => b.id === id)).toMatchObject({ date, time: "10:15" });
  });

  it("buffers are part of the own window (service with buffer before/after)", async () => {
    const date = addDays(monday, 28);
    const { id } = await bookAndClaim(C1, date, "12:00", svcBufId);
    const slots = await getRescheduleSlots(deps(), C1, id, date);
    expect(slots.some((s) => s.time === "12:15")).toBe(true);
    await rescheduleMyBooking(deps(), C1, id, date, "12:15", staffId);
    expect((await listMyBookings(deps(), C1)).find((b) => b.id === id)?.time).toBe("12:15");
  });

  it("onto an occupied slot -> slot_unavailable (also when the slot list is stale)", async () => {
    const date = addDays(monday, 35);
    const { id } = await bookAndClaim(C1, date, "09:00");
    const other = await guestBook(date, "14:00");
    await expect(rescheduleMyBooking(deps(), C1, id, date, "14:00", staffId)).rejects.toMatchObject({ code: "slot_unavailable" });
    // the database exclusion constraint is the final judge
    const direct = await admin().rpc("reschedule_my_booking", {
      p_user_id: C1, p_appointment_id: id, p_new_starts_at: new Date((await q<{ starts_at: Date }>("select starts_at from appointments where id=$1", [other]))[0].starts_at).toISOString(), p_staff_id: staffId, p_resource_id: null,
    });
    expect(direct.error).toBeTruthy();
  });

  it("outside working hours / day off -> slot_unavailable", async () => {
    const date = addDays(monday, 42);
    const { id } = await bookAndClaim(C1, date, "09:00");
    await expect(rescheduleMyBooking(deps(), C1, id, date, "23:00", staffId)).rejects.toMatchObject({ code: "slot_unavailable" });
    await expect(rescheduleMyBooking(deps(), C1, id, addDays(date, -1), "10:00", staffId)).rejects.toMatchObject({ code: "slot_unavailable" });
    expect(await getRescheduleSlots(deps(), C1, id, addDays(date, -1))).toEqual([]);
  });

  it("past dates and bad input are refused", async () => {
    const { id } = await bookAndClaim(C1, addDays(monday, 49), "09:00");
    await expect(rescheduleMyBooking(deps(), C1, id, "2020-01-06", "10:00", staffId)).rejects.toMatchObject({ code: "slot_unavailable" });
    await expect(rescheduleMyBooking(deps(), C1, id, "2030-1-1", "10:00", staffId)).rejects.toMatchObject({ code: "invalid_input" });
    await expect(rescheduleMyBooking(deps(), C1, id, monday, "10:00", "nope")).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("cancel", () => {
  it("cancel frees the slot for guest booking again, and cannot be repeated", async () => {
    const date = addDays(monday, 56);
    const { id } = await bookAndClaim(C1, date, "11:00");
    expect(await publicTimes(date)).not.toContain("11:00");
    await cancelMyBooking(deps(), C1, id);
    expect(await publicTimes(date)).toContain("11:00");
    await expect(guestBook(date, "11:00")).resolves.toBeTruthy();
    const mine = (await listMyBookings(deps(), C1)).find((b) => b.id === id)!;
    expect(mine).toMatchObject({ status: "cancelled", canCancel: false, canReschedule: false });
    await expect(cancelMyBooking(deps(), C1, id)).rejects.toMatchObject({ code: "not_manageable" });
    await expect(rescheduleMyBooking(deps(), C1, id, date, "12:00", staffId)).rejects.toMatchObject({ code: "not_manageable" });
  });

  it("mutating actions are rate limited", async () => {
    const denied = { hit: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 3 }) };
    const id = "33333333-0000-4000-8000-000000000003";
    await expect(cancelMyBooking(deps({ rateLimiter: denied }), C1, id)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(getRescheduleSlots(deps({ rateLimiter: denied }), C1, id, monday)).rejects.toMatchObject({ code: "rate_limited" });
    await expect(rescheduleMyBooking(deps({ rateLimiter: denied }), C1, id, monday, "10:00", null)).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("mapping, timezone and ordering", () => {
  const row = (startsAt: string, endsAt: string, over: Record<string, unknown> = {}) => ({
    out_appointment_id: "x", out_workspace_id: "w", out_workspace_slug: "biz", out_workspace_name: "Biz", out_timezone: "Europe/Berlin",
    out_starts_at: startsAt, out_ends_at: endsAt, out_status: "confirmed", out_service_id: "s", out_service_name: "S",
    out_staff_id: "p", out_staff_name: "P", out_resource_id: null, out_price: "40.00", out_currency: "EUR", ...over,
  });

  it("date/time/isUpcoming are computed in the business zone, around the UTC-day != Berlin-day boundary", () => {
    // 22:30Z on 14 June = 00:30 CEST on 15 June
    const r = row("2030-06-14T22:30:00Z", "2030-06-14T23:00:00Z");
    const before = mapBookingRow(r, new Date("2030-06-14T22:29:59Z"));
    expect(before).toMatchObject({ date: "2030-06-15", time: "00:30", endTime: "01:00", isUpcoming: true, canCancel: true, price: 40 });
    expect(mapBookingRow(r, new Date("2030-06-14T22:30:01Z"))).toMatchObject({ isUpcoming: false, canCancel: false, canReschedule: false });
    // winter: 23:30Z = 00:30 CET next day
    expect(mapBookingRow(row("2030-01-14T23:30:00Z", "2030-01-15T00:00:00Z"), new Date("2030-01-01T00:00:00Z"))).toMatchObject({ date: "2030-01-15", time: "00:30" });
  });

  it("canCancel needs pending/confirmed; canReschedule also needs service and staff", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const f = (o: Record<string, unknown>) => mapBookingRow(row("2030-02-01T10:00:00Z", "2030-02-01T10:30:00Z", o), now);
    expect(f({ out_status: "completed" }).canCancel).toBe(false);
    expect(f({ out_status: "pending" }).canCancel).toBe(true);
    expect(f({ out_staff_id: null })).toMatchObject({ canCancel: true, canReschedule: false });
    expect(f({ out_service_id: null }).canReschedule).toBe(false);
  });

  it("sorted: upcoming ascending, then past descending; demo workspaces never appear", async () => {
    const now = new Date("2030-06-01T12:00:00Z");
    const rows = [
      row("2030-05-01T10:00:00Z", "2030-05-01T10:30:00Z", { out_appointment_id: "past-old" }),
      row("2030-07-10T10:00:00Z", "2030-07-10T10:30:00Z", { out_appointment_id: "up-late" }),
      row("2030-05-20T10:00:00Z", "2030-05-20T10:30:00Z", { out_appointment_id: "past-new" }),
      row("2030-06-05T10:00:00Z", "2030-06-05T10:30:00Z", { out_appointment_id: "up-soon" }),
      row("2030-06-06T10:00:00Z", "2030-06-06T10:30:00Z", { out_appointment_id: "demo", out_workspace_slug: "demo-salon" }),
    ];
    const fake = { rpc: async () => ({ data: rows, error: null }) } as unknown as ClientAccountDeps["admin"];
    const list = await listMyBookings(deps({ admin: fake, now: () => now }), C1);
    expect(list.map((b) => b.id)).toEqual(["up-soon", "up-late", "past-new", "past-old"]);
    // a demo workspace id is not manageable either, even if the database returned it
    await expect(cancelMyBooking(deps({ admin: fake, now: () => now }), C1, "44444444-0000-4000-8000-000000000004")).rejects.toMatchObject({ code: "not_found" });
  });

  it("database errors become codes and never leak text", async () => {
    const fake = { rpc: async () => ({ data: null, error: { message: "secret table detail", code: "XX000" } }) } as unknown as ClientAccountDeps["admin"];
    const err = await listMyBookings(deps({ admin: fake }), C1).catch((e) => e);
    expect(err).toMatchObject({ code: "unknown", message: "unknown" });
  });
});

describe("guest booking stays account-free; ensureClientAccount", () => {
  it("a guest booking works with no account and lands in the business tables (clients + appointments)", async () => {
    const date = addDays(monday, 63);
    const id = await guestBook(date, "10:00");
    const a = (await q<{ source: string; client_id: string }>("select source::text, client_id from appointments where id=$1", [id]))[0];
    expect(a.source).toBe("public");
    expect((await q("select 1 from clients where id=$1 and workspace_id=$2", [a.client_id, wsId])).length).toBe(1);
    expect((await q("select 1 from booking_claims where appointment_id=$1", [id])).length).toBe(0);
  });

  it("ensureClientAccount is idempotent and never wipes the profile with empty values", async () => {
    await ensureClientAccount(deps(), C1, { fullName: "Anna", locale: "de" });
    await ensureClientAccount(deps(), C1, {});
    await ensureClientAccount(deps(), C1, { phone: "+49 1", locale: "xx" });
    expect((await q("select full_name, phone, locale from client_accounts where user_id=$1", [C1]))[0]).toEqual({ full_name: "Anna", phone: "+49 1", locale: "de" });
    // the CRM table is untouched: accounts and ClientRecords are different entities
    expect((await q("select 1 from clients where lower(email) = 'c1@test.invalid'")).length).toBe(0);
  });
});
