import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { createMemoryRateLimiter } from "../../ratelimit/memoryRateLimiter";

// The business services/registry/repositories all call createSupabaseServerClient();
// point it at a real Postgres, acting as whichever user the test selects.
let current: SupabaseClient;
// `getSession` treats an unconfigured Supabase as "no real workspaces"; mark it configured (values unused: the client is the test double).
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const appointmentsService = await import("@/server/services/appointments.service");
const clientsService = await import("@/server/services/clients.service");
const { createPublicBooking, getPublicSlots } = await import("../publicBooking.service");
const { BusinessRuleError } = await import("@/server/services/businessRuleError");
const { PermissionDeniedError } = await import("@/server/permissions/roles");
const { createPostgresRateLimiter } = await import("../../ratelimit/postgresRateLimiter");
const { addDays } = await import("@/lib/time/zonedTime");
void createPostgresRateLimiter;

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const MANAGER = "cccccccc-0000-4000-8000-0000000000c3";
const STAFF = "dddddddd-0000-4000-8000-0000000000d4";

let db: PGlite;
let slug: string;
let wsId: string;
let staffId: string;
let svcId: string;
let monday: string;

const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const service = () => createPgliteSupabaseClient(db, { kind: "service" });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;

function nextMonday() {
  const d0 = new Date(Date.now() + 3 * 86_400_000);
  for (let i = 0; i < 7; i++) {
    const t = new Date(d0.getTime() + i * 86_400_000);
    if (t.getUTCDay() === 1) return t.toISOString().slice(0, 10);
  }
  return d0.toISOString().slice(0, 10);
}

const input = (over: Record<string, unknown> = {}) => ({
  client: "Walk-in", service: "Haircut", staff: "You", serviceId: undefined as string | undefined, staffId: undefined as string | undefined,
  resourceId: null, date: monday, time: "10:00", durationMinutes: 30, price: 40, currency: "EUR", notes: "",
  visibility: "normal" as const, financialBucket: "main" as const, status: "confirmed" as const, paid: false, ...over,
});

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@test.invalid'),('${MANAGER}','m@test.invalid'),('${STAFF}','s@test.invalid')`);
  const r = (await service().rpc("provision_workspace", { p_user_id: OWNER, p_email: "o@test.invalid", p_full_name: "", p_business_name: "Biz", p_base_slug: "biz-salon", p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[];
  wsId = r[0].out_workspace_id;
  slug = r[0].out_slug;
  await db.exec(`insert into profiles (id,email) values ('${MANAGER}','m@test.invalid'),('${STAFF}','s@test.invalid');
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${MANAGER}','manager'),('${wsId}','${STAFF}','staff')`);
  staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
  svcId = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Haircut',30,40) returning id", [wsId]))[0].id;
  monday = nextMonday();
}, 90_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("Business services on the shared database", () => {
  it("real session: the workspace and role come from the user's own membership", async () => {
    as(OWNER);
    expect(await getSession(slug)).toMatchObject({ userId: OWNER, workspaceId: wsId, role: "owner" });
    as(MANAGER);
    expect((await getSession(slug)).role).toBe("manager");
  });

  it("someone else's workspace is indistinguishable from a missing one", async () => {
    await db.exec(`insert into auth.users (id,email) values ('99999999-0000-4000-8000-000000000009','x@test.invalid')`);
    as("99999999-0000-4000-8000-000000000009");
    await expect(getSession(slug)).rejects.toMatchObject({ name: "WorkspaceAccessError" });
    await expect(getSession("no-such-workspace")).rejects.toMatchObject({ name: "WorkspaceAccessError" });
  });

  it("the owner creates a client and an appointment; both persist and are listed", async () => {
    const session = await (as(OWNER), getSession(slug));
    const client = await clientsService.createClient(session, { name: "Walk-in", email: "walkin@example.test", phone: "+49 1", tags: [], notes: "" });
    expect(client.id).toMatch(/^[0-9a-f-]{36}$/); // database-assigned stable id
    const appt = await appointmentsService.createAppointment(session, input({ clientId: client.id, serviceId: svcId, staffId }));
    expect(appt).toMatchObject({ client: "Walk-in", service: "Haircut", date: monday, time: "10:00", status: "confirmed" });
    const listed = (await appointmentsService.listAppointments(session)).filter((a) => !a.masked);
    expect(listed.map((a) => a.id)).toContain(appt.id);
    expect((await clientsService.getClient(session, client.id))?.upcoming).toEqual([{ date: monday, time: "10:00", service: "Haircut" }]);
  });

  it("the Business check and Public Booking use ONE availability rule: what Public Booking hides, Business refuses", async () => {
    const session = await (as(OWNER), getSession(slug));
    const deps = { admin: service(), rateLimiter: createMemoryRateLimiter() };
    const slots = await getPublicSlots(deps, { ip: "x" }, { slug, serviceId: svcId, staffId, date: monday });
    expect(slots.some((s) => s.time === "10:00")).toBe(false); // taken by the previous test
    await expect(appointmentsService.createAppointment(session, input({ serviceId: svcId, staffId, time: "10:00" }))).rejects.toMatchObject({ code: "staff_conflict" });
    await expect(appointmentsService.createAppointment(session, input({ serviceId: svcId, staffId, time: "10:15" }))).rejects.toBeInstanceOf(BusinessRuleError);
    // a time Public Booking offers is accepted
    expect(slots.some((s) => s.time === "11:00")).toBe(true);
    await expect(appointmentsService.createAppointment(session, input({ serviceId: svcId, staffId, time: "11:00", client: "Walk-in" }))).resolves.toMatchObject({ time: "11:00" });
  });

  it("outside working hours is refused (Sunday: day off by default)", async () => {
    const session = await (as(OWNER), getSession(slug));
    const sunday = addDays(monday, -1);
    await expect(appointmentsService.createAppointment(session, input({ serviceId: svcId, staffId, date: sunday, time: "10:00" }))).rejects.toMatchObject({ code: "outside_working_hours" });
  });

  it("a guest's booking blocks the Business side, and the Business side blocks the guest (same database)", async () => {
    const session = await (as(OWNER), getSession(slug));
    const deps = { admin: service(), rateLimiter: createMemoryRateLimiter() };
    const date = addDays(monday, 7);
    await createPublicBooking(deps, { ip: "y" }, { slug, serviceId: svcId, staffId, date, time: "14:00", client: { name: "G", email: "g@example.test", phone: "+49 170 000 000", notes: "" } });
    await expect(appointmentsService.createAppointment(session, input({ serviceId: svcId, staffId, date, time: "14:00" }))).rejects.toMatchObject({ code: "staff_conflict" });
    await appointmentsService.createAppointment(session, input({ serviceId: svcId, staffId, date, time: "15:00" }));
    const slots = await getPublicSlots(deps, { ip: "y" }, { slug, serviceId: svcId, staffId, date });
    expect(slots.some((s) => s.time === "15:00")).toBe(false);
  });

  it("permissions: a staff member can view but not edit clients; a manager cannot read PRIVATE appointments", async () => {
    const owner = await (as(OWNER), getSession(slug));
    const clientId = (await clientsService.listClients(owner))[0].id;
    const secret = await appointmentsService.createAppointment(owner, input({ clientId, serviceId: svcId, staffId, date: addDays(monday, 14), time: "09:00", visibility: "private", notes: "private note" }));

    const staff = await (as(STAFF), getSession(slug));
    expect((await clientsService.listClients(staff)).length).toBeGreaterThan(0);
    await expect(clientsService.createClient(staff, { name: "X", email: "", phone: "", tags: [], notes: "" })).rejects.toBeInstanceOf(PermissionDeniedError);

    const manager = await (as(MANAGER), getSession(slug));
    const seen = (await appointmentsService.listAppointments(manager)).find((a) => a.id === secret.id)!;
    expect(seen.masked).toBe(true);
    expect(JSON.stringify(seen)).not.toMatch(/private note|Walk-in/);
    expect((await appointmentsService.getAppointment(manager, secret.id))?.masked).toBe(true);
    // the manager still cannot double-book over it (the masked block counts as busy)
    await expect(appointmentsService.createAppointment(manager, input({ serviceId: svcId, staffId, date: addDays(monday, 14), time: "09:00" }))).rejects.toMatchObject({ code: "staff_conflict" });
  });

  it("move / cancel persist, and cancelling frees the time", async () => {
    const session = await (as(OWNER), getSession(slug));
    const date = addDays(monday, 21);
    const a = await appointmentsService.createAppointment(session, input({ serviceId: svcId, staffId, date, time: "09:00" }));
    const moved = await appointmentsService.moveAppointment(session, { id: a.id, date, time: "13:00" });
    expect(moved).toMatchObject({ time: "13:00" });
    const cancelled = await appointmentsService.cancelAppointment(session, a.id);
    expect(cancelled?.status).toBe("cancelled");
    await expect(appointmentsService.createAppointment(session, input({ serviceId: svcId, staffId, date, time: "13:00" }))).resolves.toBeTruthy();
    const log = await q<{ action: string }>("select action from audit_logs where workspace_id=$1 and source='user'", [wsId]);
    expect(log.map((l) => l.action)).toEqual(expect.arrayContaining(["created", "moved", "cancelled"]));
  });

  it("another workspace's user cannot read or change this workspace's data", async () => {
    await db.exec(`insert into auth.users (id,email) values ('88888888-0000-4000-8000-000000000008','z@test.invalid')`);
    const r2 = (await service().rpc("provision_workspace", { p_user_id: "88888888-0000-4000-8000-000000000008", p_email: "z@test.invalid", p_full_name: "", p_business_name: "Other", p_base_slug: "other-salon", p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[];
    const other = await (as("88888888-0000-4000-8000-000000000008"), getSession(r2[0].out_slug));
    expect(await appointmentsService.listAppointments(other)).toEqual([]);
    expect(await clientsService.listClients(other)).toEqual([]);
    // forging this workspace's session id by hand still gets nothing: RLS, not just app code
    const forged = { ...other, workspaceId: wsId };
    expect(await appointmentsService.listAppointments(forged)).toEqual([]);
    expect(await clientsService.listClients(forged)).toEqual([]);
  });
});
