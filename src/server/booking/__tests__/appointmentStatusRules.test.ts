import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMigratedDb } from "@/server/db/__tests__/pg";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";

/** Status rules, "cancelled frees the slot" and the delete policy, enforced by the SERVER (real Postgres). */
let current: SupabaseClient;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => current }));

const { getSession } = await import("@/server/auth/session");
const svc = await import("@/server/services/appointments.service");
const { PermissionDeniedError } = await import("@/server/permissions/roles");

const OWNER = "aaaaaaaa-0000-4000-8000-0000000000f1";
const MANAGER = "cccccccc-0000-4000-8000-0000000000f3";

let db: PGlite;
let slug: string;
let wsId: string;
let staffId: string;
let svcId: string;
let future: string;

const as = (id: string) => (current = createPgliteSupabaseClient(db, { kind: "user", id }));
const service = () => createPgliteSupabaseClient(db, { kind: "service" });
const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const owner = async () => (as(OWNER), getSession(slug));

function nextWeekday() {
  // Working hours of a new workspace: Mon-Fri. Pick a weekday at least 3 days ahead.
  for (let i = 3; i < 10; i++) {
    const t = new Date(Date.now() + i * 86_400_000);
    if (t.getUTCDay() >= 1 && t.getUTCDay() <= 5) return t.toISOString().slice(0, 10);
  }
  throw new Error("unreachable");
}

const input = (over: Record<string, unknown> = {}) => ({
  client: "Walk-in", service: "Haircut", staff: "You", serviceId: svcId, staffId,
  resourceId: null, date: future, time: "10:00", durationMinutes: 30, price: 40, currency: "EUR", notes: "",
  visibility: "normal" as const, financialBucket: "main" as const, status: "confirmed" as const, paid: false, ...over,
});

/** An appointment that already started (inserted directly: the booking rules refuse the past). */
let pastCounter = 0;
async function pastAppointment(status = "confirmed", source = "user") {
  const hoursAgo = 48 + pastCounter++; // distinct hours: confirmed rows still hold their slot
  const bucket = (await q<{ id: string }>("select id from financial_buckets where workspace_id=$1 and kind='main'", [wsId]))[0].id;
  return (
    await q<{ id: string }>(
      `insert into appointments (workspace_id, service_id, staff_id, starts_at, ends_at, status, source, financial_bucket_id, created_by)
       values ($1,$2,$3, now() - make_interval(hours => $8), now() - make_interval(hours => $8) + interval '30 minutes', $4, $5, $6, $7) returning id`,
      [wsId, svcId, staffId, status, source, bucket, OWNER, hoursAgo],
    )
  )[0].id;
}

beforeAll(async () => {
  db = await createMigratedDb();
  await db.exec(`insert into auth.users (id,email) values ('${OWNER}','o@test.invalid'),('${MANAGER}','m@test.invalid')`);
  const r = (await service().rpc("provision_workspace", { p_user_id: OWNER, p_email: "o@test.invalid", p_full_name: "", p_business_name: "Biz", p_base_slug: "status-rules", p_locale: "en" })).data as { out_workspace_id: string; out_slug: string }[];
  wsId = r[0].out_workspace_id;
  slug = r[0].out_slug;
  await db.exec(`insert into profiles (id,email) values ('${MANAGER}','m@test.invalid');
    insert into workspace_members (workspace_id,profile_id,role) values ('${wsId}','${MANAGER}','manager')`);
  staffId = (await q<{ id: string }>("select id from staff_profiles where workspace_id=$1", [wsId]))[0].id;
  svcId = (await q<{ id: string }>("insert into services (workspace_id,name,duration_minutes,price) values ($1,'Haircut',30,40) returning id", [wsId]))[0].id;
  await q("insert into clients (workspace_id,name,email) values ($1,'Walk-in','walkin@test.invalid')", [wsId]);
  future = nextWeekday();
}, 90_000);

afterAll(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("status rules (server)", () => {
  it("a future appointment cannot be created as / changed to Completed or No-show", async () => {
    const s = await owner();
    await expect(svc.createAppointment(s, input({ time: "09:00", status: "completed" }))).rejects.toMatchObject({ code: "invalid_status_transition" });
    await expect(svc.createAppointment(s, input({ time: "09:00", status: "noShow" }))).rejects.toMatchObject({ code: "invalid_status_transition" });
    const a = await svc.createAppointment(s, input({ time: "09:00" }));
    await expect(svc.updateAppointment(s, a.id, { status: "completed" })).rejects.toMatchObject({ code: "invalid_status_transition" });
    await expect(svc.updateAppointment(s, a.id, { status: "noShow" })).rejects.toMatchObject({ code: "invalid_status_transition" });
    await expect(svc.updateAppointment(s, a.id, { status: "rescheduled" })).rejects.toMatchObject({ code: "invalid_status_transition" });
    expect((await svc.getAppointment(s, a.id))?.status).toBe("confirmed");
  });

  it("a cancelled appointment frees its time; restoring it re-checks the slot", async () => {
    const s = await owner();
    const a = await svc.createAppointment(s, input({ time: "11:00" }));
    await expect(svc.createAppointment(s, input({ time: "11:00" }))).rejects.toMatchObject({ code: "staff_conflict" });
    await svc.cancelAppointment(s, a.id);
    const b = await svc.createAppointment(s, input({ time: "11:00" }));
    expect(b.status).toBe("confirmed");
    // Restoring the cancelled one would double-book: refused by the normal conflict check.
    await expect(svc.updateAppointment(s, a.id, { status: "confirmed" })).rejects.toMatchObject({ code: "staff_conflict" });
    // Cancelling twice is a no-op, not an error.
    await expect(svc.cancelAppointment(s, a.id)).resolves.toMatchObject({ status: "cancelled" });
  });

  it("after the start: No-show, correction to Completed (audited as a correction), no cancel, no move", async () => {
    const s = await owner();
    const id = await pastAppointment();
    expect((await svc.updateAppointment(s, id, { status: "noShow" }))?.status).toBe("noShow");
    expect((await svc.updateAppointment(s, id, { status: "completed" }))?.status).toBe("completed");
    const [{ summary }] = await q<{ summary: string }>("select summary from audit_logs where entity_id=$1 order by created_at desc, id desc limit 1", [id]);
    expect(summary).toMatch(/noShow → completed \(correction\)/);
    await expect(svc.cancelAppointment(s, id)).rejects.toMatchObject({ code: "invalid_status_transition" });
    await expect(svc.moveAppointment(s, { id, date: future, time: "15:00" })).rejects.toMatchObject({ code: "invalid_status_transition" });
    // A started, still confirmed appointment cannot be cancelled either (it happened or it was a no-show).
    const other = await pastAppointment();
    await expect(svc.cancelAppointment(s, other)).rejects.toMatchObject({ code: "invalid_status_transition" });
  });
});

describe("physical delete: only appointments created by mistake", () => {
  it("owner deletes a fresh business-created appointment; manager may not", async () => {
    const s = await owner();
    const a = await svc.createAppointment(s, input({ time: "13:00" }));
    as(MANAGER);
    const m = await getSession(slug);
    expect(await svc.getAppointmentDeleteBlockers(m, a.id)).toEqual(["not_permitted"]);
    await expect(svc.removeAppointment(m, a.id)).rejects.toBeInstanceOf(PermissionDeniedError);
    const o = await owner();
    expect(await svc.getAppointmentDeleteBlockers(o, a.id)).toEqual([]);
    await svc.removeAppointment(o, a.id);
    expect(await svc.getAppointment(o, a.id)).toBeUndefined();
  });

  it("history and online bookings are kept", async () => {
    const s = await owner();
    const done = await pastAppointment("completed");
    expect(await svc.getAppointmentDeleteBlockers(s, done)).toEqual(["has_history"]);
    await expect(svc.removeAppointment(s, done)).rejects.toMatchObject({ code: "delete_not_allowed" });
    const online = await pastAppointment("confirmed", "public");
    expect(await svc.getAppointmentDeleteBlockers(s, online)).toEqual(["online_booking"]);
    await expect(svc.removeAppointment(s, online)).rejects.toMatchObject({ code: "delete_not_allowed" });
    expect(await q("select 1 from appointments where id = any($1)", [[done, online]])).toHaveLength(2);
  });
});
