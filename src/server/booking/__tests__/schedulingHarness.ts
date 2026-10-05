import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createPgliteSupabaseClient } from "@/server/db/__tests__/supabasePglite";
import { createMemoryRateLimiter } from "@/server/ratelimit/memoryRateLimiter";
import {
  createPublicBooking,
  getPublicSlots,
  type PublicBookingDeps,
  type PublicBookingError,
} from "../publicBooking.service";

/**
 * Shared fixture builder for the staff-scheduling integration / security tests (Agent D).
 * Real PostgreSQL (PGlite, all migrations), real services, the Supabase shim. Every scenario gets its
 * own business (`biz()`), so scenarios never leak rows into each other. The wall clock is pinned by the
 * test files with `vi.setSystemTime` (PGlite's `now()` follows `Date`).
 */

/** Sunday 2026-10-04 20:00 in Berlin. Mon 5 Oct is the first working day of the fixtures. */
export const PINNED_NOW = "2026-10-04T18:00:00Z";
export const D = { mon: "2026-10-05", tue: "2026-10-06", wed: "2026-10-07", thu: "2026-10-08", fri: "2026-10-09", sat: "2026-10-10", sun: "2026-10-11" };

export type Intervals = [string, string][];
export type WeekMap = Record<number, Intervals>;

export interface Biz {
  ws: string;
  slug: string;
  owner: string;
  /** The owner's own staff profile ("You"), deactivated by default so scenarios control who is bookable. */
  you: string;
}

export function makeWorld(db: PGlite) {
  let counter = 0;
  const q = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
  const admin = () => createPgliteSupabaseClient(db, { kind: "service" });
  const anon = () => createPgliteSupabaseClient(db, { kind: "anon" });
  const asUser = (id: string) => createPgliteSupabaseClient(db, { kind: "user", id });

  async function user(label: string): Promise<string> {
    const id = randomUUID();
    await db.query("insert into auth.users (id, email) values ($1, $2)", [id, `${label}-${id.slice(0, 6)}@test.invalid`]);
    return id;
  }

  async function biz(label = "biz", opts: { keepYou?: boolean } = {}): Promise<Biz> {
    const owner = await user(`${label}-owner`);
    const email = (await q<{ email: string }>("select email from auth.users where id = $1", [owner]))[0].email;
    const base = `${label}-${++counter}`.toLowerCase().replace(/[^a-z0-9-]/g, "");
    const r = (
      await admin().rpc("provision_workspace", {
        p_user_id: owner, p_email: email, p_full_name: "", p_business_name: `${label} ${counter}`, p_base_slug: base, p_locale: "en",
      })
    ).data as { out_workspace_id: string; out_slug: string }[];
    const ws = r[0].out_workspace_id;
    const you = (await q<{ id: string }>("select id from staff_profiles where workspace_id = $1", [ws]))[0].id;
    if (!opts.keepYou) await q("update staff_profiles set active = false where id = $1", [you]);
    return { ws, slug: r[0].out_slug, owner, you };
  }

  /** A signed-in member of the business with the given role. */
  async function member(b: Biz, role: "admin" | "manager" | "staff" | "accountant"): Promise<string> {
    const id = await user(role);
    const email = (await q<{ email: string }>("select email from auth.users where id = $1", [id]))[0].email;
    await q("insert into profiles (id, email) values ($1, $2) on conflict do nothing", [id, email]);
    await q("insert into workspace_members (workspace_id, profile_id, role) values ($1, $2, $3)", [b.ws, id, role]);
    return id;
  }

  async function setHours(b: Biz, staffId: string | null, week: WeekMap) {
    await q("delete from working_hours where workspace_id = $1 and staff_id is not distinct from $2", [b.ws, staffId]);
    for (let wd = 0; wd <= 6; wd++) {
      const list = week[wd] ?? [];
      if (list.length === 0) {
        await q("insert into working_hours (workspace_id, staff_id, weekday, is_day_off) values ($1,$2,$3,true)", [b.ws, staffId, wd]);
      } else {
        for (const [s, e] of list) {
          await q("insert into working_hours (workspace_id, staff_id, weekday, start_time, end_time, is_day_off) values ($1,$2,$3,$4,$5,false)", [b.ws, staffId, wd, s, e]);
        }
      }
    }
  }

  async function staff(b: Biz, name: string, o: { mode?: "inherit" | "custom"; active?: boolean; hours?: WeekMap; title?: string } = {}): Promise<string> {
    const id = (
      await q<{ id: string }>(
        "insert into staff_profiles (workspace_id, name, title, schedule_mode, active) values ($1,$2,$3,$4,$5) returning id",
        [b.ws, name, o.title ?? "", o.mode ?? (o.hours ? "custom" : "inherit"), o.active ?? true],
      )
    )[0].id;
    if (o.hours) await setHours(b, id, o.hours);
    return id;
  }

  async function service(
    b: Biz,
    name: string,
    minutes: number,
    o: { before?: number; after?: number; resType?: string | null; staffIds?: string[]; price?: number } = {},
  ): Promise<string> {
    const id = (
      await q<{ id: string }>(
        "insert into services (workspace_id,name,duration_minutes,price,buffer_before_minutes,buffer_after_minutes,required_resource_type) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [b.ws, name, minutes, o.price ?? 50, o.before ?? 0, o.after ?? 0, o.resType ?? null],
      )
    )[0].id;
    for (const s of o.staffIds ?? []) await q("insert into service_staff (service_id, staff_id) values ($1,$2)", [id, s]);
    return id;
  }

  async function resource(b: Biz, name: string, type = "room", o: { active?: boolean; serviceIds?: string[] } = {}): Promise<string> {
    const id = (await q<{ id: string }>("insert into resources (workspace_id,name,type,active) values ($1,$2,$3,$4) returning id", [b.ws, name, type, o.active ?? true]))[0].id;
    for (const s of o.serviceIds ?? []) await q("insert into service_resources (service_id, resource_id) values ($1,$2)", [s, id]);
    return id;
  }

  async function timeOff(b: Biz, staffId: string | null, start: string, end: string, window?: [string, string], reason = "") {
    return (
      await q<{ id: string }>(
        "insert into time_off (workspace_id, staff_id, start_date, end_date, start_time, end_time, reason) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [b.ws, staffId, start, end, window?.[0] ?? null, window?.[1] ?? null, reason],
      )
    )[0].id;
  }

  const RULE_COLUMNS = {
    autoConfirm: "auto_confirm_bookings",
    minNoticeMinutes: "min_notice_minutes",
    maxHorizonDays: "max_horizon_days",
    slotIntervalMinutes: "slot_interval_minutes",
    cancellationDeadlineHours: "cancellation_deadline_hours",
    rescheduleDeadlineHours: "reschedule_deadline_hours",
  } as const;
  async function rules(b: Biz, r: Partial<Record<keyof typeof RULE_COLUMNS, number | boolean>>) {
    for (const [k, v] of Object.entries(r)) await q(`update workspaces set ${RULE_COLUMNS[k as keyof typeof RULE_COLUMNS]} = $1 where id = $2`, [v, b.ws]);
  }

  const deps = (o: Partial<PublicBookingDeps> = {}): PublicBookingDeps => ({ admin: admin(), rateLimiter: createMemoryRateLimiter(), ...o });
  let guestN = 0;
  const guest = () => {
    const n = ++guestN;
    return { name: `Guest ${n}`, email: `guest${n}-${counter}@example.test`, phone: `+49 170 555 ${String(1000 + n)}`, notes: "" };
  };

  const slots = (b: Biz, serviceId: string, staffId: string | null, date: string) =>
    getPublicSlots(deps(), { ip: "198.51.100.1" }, { slug: b.slug, serviceId, staffId, date });
  /** Distinct start times (any specialist collapsed). */
  const times = async (b: Biz, serviceId: string, staffId: string | null, date: string) =>
    [...new Set((await slots(b, serviceId, staffId, date)).map((s) => s.time))].sort();

  const book = (b: Biz, serviceId: string, staffId: string | null, date: string, time: string, over: Record<string, unknown> = {}) =>
    createPublicBooking(deps(), { ip: "198.51.100.1" }, { slug: b.slug, serviceId, staffId, date, time, client: guest(), ...over });

  /** Resolves to the error code of a refused booking, or "ok". */
  const outcome = async (p: Promise<unknown>): Promise<string> =>
    p.then(() => "ok", (e: unknown) => (e as PublicBookingError).code ?? String((e as Error).message));

  const row = async (id: string) =>
    (await q<{ starts_at: Date; ends_at: Date; status: string; staff_id: string; resource_id: string | null; busy_from: Date; busy_until: Date }>(
      "select starts_at, ends_at, status::text, staff_id, resource_id, busy_from, busy_until from appointments where id = $1", [id],
    ))[0];

  return { db, q, admin, anon, asUser, user, biz, member, setHours, staff, service, resource, timeOff, rules, deps, guest, slots, times, book, outcome, row };
}

export type World = ReturnType<typeof makeWorld>;

/** Every start time from `from` to `to` (inclusive) on a `step`-minute grid. */
export function grid(from: string, to: string, step = 15): string[] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const out: string[] = [];
  for (let m = toMin(from); m <= toMin(to); m += step) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  return out;
}
