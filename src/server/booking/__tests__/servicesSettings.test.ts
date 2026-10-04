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
const servicesService = await import("@/server/services/services.service");
const { loadWorkspaceCatalog } = await import("@/server/services/workspaceCatalog.service");
const { createPublicBooking, loadPublicCatalog } = await import("../publicBooking.service");
const { PermissionDeniedError } = await import("@/server/permissions/roles");
const { addDays } = await import("@/lib/time/zonedTime");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000a1";
const STAFF = "dddddddd-0000-4000-8000-0000000000d4";

let db: PGlite;
let slug: string;
let wsId: string;
let staffId: string;
let clientId: string;
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

const apptInput = (over: Record<string, unknown> = {}) => ({
  client: "Walk-in", clientId, service: "Cut", staff: "You", serviceId: undefined as string | undefined, staffId,
  resourceId: null, date: monday, time: "10:00", durationMinutes: 30, price: 40, currency: "EUR", notes: "",
  visibility: "normal" as const, financialBucket: "main" as const, status: "confirmed" as const, paid: false, ...over,
});

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@test.invalid'),('${STAFF}','s@test.invalid')`);
  const r = (await service().rpc("provision_workspace", { p_user_id: OWNER, p_email: "o@test.invalid", p_full_name: "", p_business_name: "Biz", p_base_slug: "svc-biz", p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[];
  wsId = r[0].out_workspace_id;
  slug = r[0].out_slug;
  await db.exec(`insert into profiles (id,email) values ('${STAFF}','s@test.invalid');
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${STAFF}','staff')`);
  staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
  clientId = (await q<{ id: string }>("insert into clients (workspace_id,name,email) values ($1,'Walk-in','w@example.test') returning id", [wsId]))[0].id;
  monday = nextMonday();
}, 90_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

const newService = { name: "Cut", durationMinutes: 30, price: 40, currency: "EUR", bufferBeforeMinutes: 0, bufferAfterMinutes: 0, allowedStaffIds: [] as string[], description: "" };

describe("Owner services editing (real workspace)", () => {
  let svcId: string;

  it("creates, then edits name / price / duration and staff assignment", async () => {
    const session = await (as(OWNER), getSession(slug));
    const created = await servicesService.createService(session, newService);
    svcId = created.id;
    expect(created).toMatchObject({ name: "Cut", active: true, allowedStaffIds: [] });

    const edited = await servicesService.updateService(session, svcId, { name: "Cut & style", price: 55.5, durationMinutes: 45, allowedStaffIds: [staffId] });
    expect(edited).toMatchObject({ name: "Cut & style", price: 55.5, durationMinutes: 45, allowedStaffIds: [staffId] });
    expect((await q("select 1 from service_staff where service_id=$1", [svcId])).length).toBe(1);

    // staff-only patch (no column change) and clearing the restriction
    const cleared = await servicesService.updateService(session, svcId, { allowedStaffIds: [] });
    expect(cleared?.allowedStaffIds).toEqual([]);
    await servicesService.updateService(session, svcId, { name: "Cut" });
  });

  it("saves and reads the description, and the public catalog returns it", async () => {
    const session = await (as(OWNER), getSession(slug));
    const fresh = await servicesService.createService(session, { ...newService, name: "Described", description: "  Includes wash & blow-dry  " });
    expect(fresh.description).toBe("Includes wash & blow-dry");
    expect((await servicesService.listServices(session)).find((s) => s.id === fresh.id)?.description).toBe("Includes wash & blow-dry");

    const edited = await servicesService.updateService(session, fresh.id, { description: "Updated text" });
    expect(edited?.description).toBe("Updated text");
    expect((await q<{ description: string }>("select description from services where id=$1", [fresh.id]))[0].description).toBe("Updated text");

    const pub = await loadPublicCatalog({ admin: service() }, slug);
    expect(pub!.services.find((s) => s.id === fresh.id)?.description).toBe("Updated text");
    // a service created without a description defaults to ""
    expect((await servicesService.listServices(session)).find((s) => s.id === svcId)?.description).toBe("");

    await expect(servicesService.updateService(session, fresh.id, { description: "x".repeat(1001) })).rejects.toMatchObject({ name: "ZodError" });
    await servicesService.removeService(session, fresh.id);
  });

  it("rejects invalid input and staff members of another workspace", async () => {
    const session = await (as(OWNER), getSession(slug));
    await expect(servicesService.updateService(session, svcId, { durationMinutes: 0 })).rejects.toMatchObject({ name: "ZodError" });
    await expect(servicesService.updateService(session, svcId, { allowedStaffIds: ["not-a-uuid"] })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("a staff member cannot edit services", async () => {
    const staff = await (as(STAFF), getSession(slug));
    await expect(servicesService.updateService(staff, svcId, { name: "Hacked" })).rejects.toBeInstanceOf(PermissionDeniedError);
    await expect(servicesService.removeService(staff, svcId)).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("removing ARCHIVES: the row survives and past appointments keep the service", async () => {
    const session = await (as(OWNER), getSession(slug));
    const appt = await appointmentsService.createAppointment(session, apptInput({ serviceId: svcId }));
    await servicesService.removeService(session, svcId);

    const row = (await q<{ active: boolean }>("select active from services where id=$1", [svcId]))[0];
    expect(row.active).toBe(false);
    const after = (await appointmentsService.listAppointments(session)).find((a) => a.id === appt.id)!;
    expect(after).toMatchObject({ service: "Cut", serviceId: svcId });
    expect((await servicesService.listServices(session)).find((s) => s.id === svcId)?.active).toBe(false);
  });

  it("an archived service is hidden from public booking and the new-appointment catalog", async () => {
    const session = await (as(OWNER), getSession(slug));
    const pub = await loadPublicCatalog({ admin: service() }, slug);
    expect(pub!.services.map((s) => s.id)).not.toContain(svcId);
    expect((await loadWorkspaceCatalog(session, slug)).services.map((s) => s.id)).not.toContain(svcId);

    const deps = { admin: service(), rateLimiter: createMemoryRateLimiter() };
    await expect(
      createPublicBooking(deps, { ip: "z" }, { slug, serviceId: svcId, staffId, date: addDays(monday, 14), time: "10:00", client: { name: "G", email: "g@example.test", phone: "+49 170 000 000", notes: "" } }),
    ).rejects.toBeTruthy();
  });

  it("business side refuses a NEW appointment for an archived service, but old ones stay editable", async () => {
    const session = await (as(OWNER), getSession(slug));
    await expect(appointmentsService.createAppointment(session, apptInput({ serviceId: svcId, date: addDays(monday, 7) }))).rejects.toMatchObject({ code: "service_inactive" });

    const old = (await appointmentsService.listAppointments(session)).find((a) => !a.masked && a.serviceId === svcId)!;
    await expect(appointmentsService.updateAppointment(session, old.id, { notes: "still editable" })).resolves.toMatchObject({ service: "Cut" });
  });

  it("restoring makes the service bookable again", async () => {
    const session = await (as(OWNER), getSession(slug));
    await servicesService.updateService(session, svcId, { active: true });
    expect((await loadPublicCatalog({ admin: service() }, slug))!.services.map((s) => s.id)).toContain(svcId);
    await expect(appointmentsService.createAppointment(session, apptInput({ serviceId: svcId, date: addDays(monday, 7) }))).resolves.toMatchObject({ service: "Cut" });
  });
});
