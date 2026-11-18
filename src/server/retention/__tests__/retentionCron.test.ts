import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RetentionDryRun, RetentionStore } from "../retention";

/**
 * Daily cron: CRON_SECRET, independent parts (calendar cleanup unchanged +
 * retention checks), feature flags that cannot switch anything on in this
 * stage, and logs with counts only.
 */
const SECRET = "s".repeat(32);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon";

const calendarCleanup = vi.fn();
let store: RetentionStore;
vi.mock("@/server/externalCalendar/deps", () => ({ getExternalCalendarDeps: () => ({}) }));
vi.mock("@/server/externalCalendar/service", () => ({ runExternalCalendarCleanup: (...args: unknown[]) => calendarCleanup(...args) }));
vi.mock("@/server/retention/deps", () => ({ getRetentionStore: () => store }));

const { GET } = await import("@/app/api/cron/external-calendar-cleanup/route");
const { runRetentionChecks, isFlagOn } = await import("../retention");

const DRY: RetentionDryRun = {
  clients: { total: 5, candidates: 1, blockers: { futureAppointment: 1 } },
  inboxEvents: { stale: 2, staleUnread: 0, staleForOpenProcess: 1, staleEligible: 1 },
};
const CALENDAR = { staleCachesCleared: 1, usedInvitesDeleted: 0, expiredInvitesDeleted: 0, inactiveStaffConnectionsRemoved: 0, failedSteps: [] };
const call = (auth?: string) =>
  GET(new NextRequest("https://app.test/api/cron/external-calendar-cleanup", { headers: auth ? { authorization: auth } : {} }));

function fakeStore(over: Partial<RetentionStore> = {}): RetentionStore {
  return {
    deleteExpiredUnclaimedBookingClaims: vi.fn(async () => 2),
    dryRun: vi.fn(async () => DRY),
    ...over,
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  calendarCleanup.mockReset().mockResolvedValue(CALENDAR);
  store = fakeStore();
});

afterAll(() => {
  delete process.env.CRON_SECRET;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("cron route", () => {
  it("refuses a missing secret, a wrong secret and an unconfigured secret", async () => {
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${"x".repeat(32)}`)).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await call(`Bearer ${SECRET}`)).status).toBe(401);
    expect(calendarCleanup).not.toHaveBeenCalled();
    expect(store.deleteExpiredUnclaimedBookingClaims).not.toHaveBeenCalled();
  });

  it("with the right secret runs the calendar cleanup unchanged and the retention checks", async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(calendarCleanup).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ ok: true, ...CALENDAR, failedSteps: [] });
    expect(body.retention).toMatchObject({ bookingClaimsDeleted: 2, dryRun: DRY, autoAnonymize: { active: false }, notificationDeletion: { active: false } });
  });

  it("a failing calendar cleanup does not stop the retention checks, and vice versa", async () => {
    calendarCleanup.mockRejectedValueOnce(new Error("boom"));
    let body = await (await call(`Bearer ${SECRET}`)).json();
    expect(body.failedSteps).toEqual(["calendar_cleanup"]);
    expect(body.retention.bookingClaimsDeleted).toBe(2);

    store = fakeStore({ dryRun: vi.fn(async () => { throw new Error("db down"); }) });
    const res = await call(`Bearer ${SECRET}`);
    body = await res.json();
    expect(res.status).toBe(500);
    expect(body.staleCachesCleared).toBe(1);
    expect(body.retention.bookingClaimsDeleted).toBe(2);
    expect(body.failedSteps).toEqual(["retention_dry_run"]);
  });

  it("logs counts only — no personal data, ids or error texts", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    store = fakeStore({ deleteExpiredUnclaimedBookingClaims: vi.fn(async () => { throw new Error("anna@example.invalid token=abc"); }) });
    calendarCleanup.mockRejectedValueOnce(new Error("Anna Müller +49 30 123"));
    await call(`Bearer ${SECRET}`);
    const logged = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    expect(logged).not.toMatch(/anna@|Anna|\+49|token=/);
    expect(logged).toContain("[retention]");
    info.mockRestore();
    error.mockRestore();
  });
});

describe("retention checks", () => {
  it("steps are independent: a failing claim cleanup still produces the dry run", async () => {
    const report = await runRetentionChecks({
      store: fakeStore({ deleteExpiredUnclaimedBookingClaims: vi.fn(async () => { throw new Error("x"); }) }),
      env: {},
    });
    expect(report.failedSteps).toEqual(["expired_booking_claims"]);
    expect(report.dryRun).toEqual(DRY);
  });

  it("reports a full batch so the next run continues", async () => {
    const report = await runRetentionChecks({ store: fakeStore({ deleteExpiredUnclaimedBookingClaims: vi.fn(async () => 500) }), env: {} });
    expect(report.bookingClaimsBatchFull).toBe(true);
  });

  it("flags: only the exact string 'true' counts, and nothing is ever activated in this stage", async () => {
    for (const v of [undefined, "", "TRUE", "1", "yes", " true"]) expect(isFlagOn(v)).toBe(false);
    expect(isFlagOn("true")).toBe(true);
    const s = fakeStore();
    const report = await runRetentionChecks({ store: s, env: { AUTO_ANONYMIZE_ENABLED: "true", INBOX_RETENTION_DELETE_ENABLED: "true" } });
    expect(report.autoAnonymize).toEqual({ requested: true, active: false });
    expect(report.notificationDeletion).toEqual({ requested: true, active: false });
    // The store has no anonymise / delete-notification operation at all; only these two were called.
    expect(Object.keys(s).sort()).toEqual(["deleteExpiredUnclaimedBookingClaims", "dryRun"]);
  });

  it("passes provisional cutoffs: 36 months for clients, 12 for notifications, 30 days grace for claims", async () => {
    const s = fakeStore();
    const now = new Date("2026-11-02T03:17:00Z");
    await runRetentionChecks({ store: s, env: {}, now: () => now });
    expect(s.deleteExpiredUnclaimedBookingClaims).toHaveBeenCalledWith(new Date("2026-10-03T03:17:00Z"), 500);
    expect(s.dryRun).toHaveBeenCalledWith(new Date("2023-11-02T03:17:00Z"), new Date("2025-11-02T03:17:00Z"));
  });
});
