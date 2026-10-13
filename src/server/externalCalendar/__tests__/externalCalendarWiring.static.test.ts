import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Pins that EVERY server path that offers or writes a time consults external
 * calendars, and that the write paths demand a fresh answer ("commit").
 * Behaviour is covered by externalCalendarIntegration.test.ts; this guards
 * against a future caller bypassing the integration.
 */
const root = path.resolve(__dirname, "../../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("external calendar wiring", () => {
  it("production booking deps carry the external busy loader", () => {
    expect(read("src/server/booking/deps.ts")).toMatch(/externalBusy: getExternalBusyLoader\(\)/);
  });

  it("guest booking re-checks with mode 'commit' before writing; slots and dates use the same loader", () => {
    const s = read("src/server/booking/publicBooking.service.ts");
    expect(s).toMatch(/computeSlots\(deps, catalog, serviceId, staffId, date, undefined, "commit"\)/);
    expect(s.match(/loadExternalInput\(/g)?.length).toBeGreaterThanOrEqual(3); // definition + slots + dates
  });

  it("client reschedule re-checks with mode 'commit'; its slot list uses the shared computeSlots", () => {
    const s = read("src/server/clientAccount/clientAccount.service.ts");
    expect(s).toMatch(/computeSlots\(deps, ctx\.catalog, ctx\.own\.serviceId!, staffId, date, ctx\.ignore, "commit"\)/);
    expect(s).toMatch(/"externalBusy">/);
  });

  it("business create / update / move all go through the external calendar check", () => {
    const s = read("src/server/services/appointments.service.ts");
    expect(s).toMatch(/rejectInactiveService: true, checkExternalCalendar: true/);
    expect(s).toMatch(/checkExternalCalendar: slotChanged\(before, merged\)/);
    expect(s).toMatch(/checkExternalCalendar: slotChanged\(before, \{ \.\.\.before, date, time \}\)/);
    expect(s).toMatch(/mode: "commit"/);
  });

  it("only read-only calendar scopes + openid are ever requested (nothing that writes, no email/profile)", async () => {
    const { GOOGLE_SCOPES, GOOGLE_IDENTIFY_SCOPES } = await import("../googleProvider");
    expect([...GOOGLE_SCOPES].sort()).toEqual([
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.freebusy",
      "openid",
    ]);
    expect([...GOOGLE_IDENTIFY_SCOPES]).toEqual(["openid"]);
  });

  it("the only code paths that revoke at Google go through releaseGrant (shared-grant check)", () => {
    const service = read("src/server/externalCalendar/service.ts");
    expect(service.match(/provider\.revoke\(/g)).toHaveLength(1);
    expect(service).toMatch(/async function releaseGrant[\s\S]*?listConnectionsBySubject[\s\S]*?provider\.revoke\(/);
    for (const f of ["src/app/connect-calendar/actions.ts", "src/server/actions/externalCalendar.actions.ts", "src/server/services/staffAdmin.service.ts"]) {
      expect(read(f)).not.toMatch(/\.revoke\(/);
    }
  });

  it("Google secrets are server-only env names (never NEXT_PUBLIC_) and only read in deps.ts", () => {
    const deps = read("src/server/externalCalendar/deps.ts");
    expect(deps).toMatch(/process\.env\.GOOGLE_CALENDAR_CLIENT_SECRET/);
    expect(deps).toMatch(/process\.env\.EXTERNAL_CALENDAR_ENCRYPTION_KEY/);
    expect(deps).toMatch(/^import "server-only";/m);
    expect(read(".env.example")).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(GOOGLE|CALENDAR)/);
  });
});
