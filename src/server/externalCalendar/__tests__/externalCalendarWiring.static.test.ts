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

  it("no scope that could write to Google is ever requested", () => {
    const g = read("src/server/externalCalendar/googleProvider.ts");
    const scopes = g.slice(g.indexOf("GOOGLE_SCOPES = ["), g.indexOf("] as const"));
    expect(scopes).toMatch(/calendar\.freebusy/);
    expect(scopes).toMatch(/calendar\.calendarlist\.readonly/);
    expect(scopes).not.toMatch(/calendar\.events|auth\/calendar"|calendar\.app\.created|openid|email|profile/);
  });

  it("Google secrets are server-only env names (never NEXT_PUBLIC_) and only read in deps.ts", () => {
    const deps = read("src/server/externalCalendar/deps.ts");
    expect(deps).toMatch(/process\.env\.GOOGLE_CALENDAR_CLIENT_SECRET/);
    expect(deps).toMatch(/process\.env\.EXTERNAL_CALENDAR_ENCRYPTION_KEY/);
    expect(deps).toMatch(/^import "server-only";/m);
    expect(read(".env.example")).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(GOOGLE|CALENDAR)/);
  });
});
