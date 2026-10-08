import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sanitizeClientRedirect, DEFAULT_CLIENT_REDIRECT, clientAuthHref } from "@/features/clientAccount/redirect";
import { clientErrorKey, splitMyBookings, toAppointmentStatus } from "@/features/clientAccount/presentation";
import type { ClientActionErrorCode, MyBooking } from "@/features/clientAccount/types";
import { en } from "@/lib/i18n/data/en";
import { de } from "@/lib/i18n/data/de";
import { uk } from "@/lib/i18n/data/uk";
import { ru } from "@/lib/i18n/data/ru";

const read = (p: string) => readFileSync(p, "utf8");

describe("sanitizeClientRedirect", () => {
  it("keeps internal /client paths", () => {
    expect(sanitizeClientRedirect("/client/bookings")).toBe("/client/bookings");
    expect(sanitizeClientRedirect("/client")).toBe("/client");
    expect(sanitizeClientRedirect("/client/book?demo=1")).toBe("/client/book?demo=1");
  });
  it.each([
    "//evil.com",
    "/client//evil.com",
    "https://evil.com",
    "/clientx",
    "/client/../login",
    "/client/./x",
    "javascript:alert(1)",
    "/\\evil.com",
    "/client/%2e%2e/login",
    "/client%2f..",
    "/client/bookings\n",
    "",
    "/login",
    "evil.com",
  ])("rejects %j", (value) => {
    expect(sanitizeClientRedirect(value)).toBe(DEFAULT_CLIENT_REDIRECT);
  });
  it("rejects non-strings and takes the first of repeated params", () => {
    expect(sanitizeClientRedirect(undefined)).toBe(DEFAULT_CLIENT_REDIRECT);
    expect(sanitizeClientRedirect(["/client/bookings", "//evil.com"])).toBe("/client/bookings");
    expect(sanitizeClientRedirect(["//evil.com"])).toBe(DEFAULT_CLIENT_REDIRECT);
  });
  it("builds auth links carrying only the sanitized path", () => {
    expect(clientAuthHref("login")).toBe("/client/login?redirect=%2Fclient%2Fbookings");
    expect(clientAuthHref("signup", "//evil.com")).toBe("/client/signup?redirect=%2Fclient%2Fbookings");
  });
});

describe("client auth forms", () => {
  const files = ["src/app/client/login/LoginForm.tsx", "src/app/client/signup/SignupForm.tsx"];
  it("use PasswordInput for the password field, never a plain password Input", () => {
    for (const f of files) {
      const src = read(f);
      expect(src).toMatch(/<PasswordInput/);
      expect(src).not.toMatch(/<Input[^>]*type="password"/);
    }
  });
  it("post the hidden redirect and call the server actions, with no fake Google button", () => {
    for (const f of files) {
      const src = read(f);
      expect(src).toMatch(/name="redirect"/);
      expect(src).toMatch(/useActionState/);
      expect(src).not.toMatch(/googleButton/);
    }
    expect(read(files[1])).toMatch(/name="fullName"/);
  });
  it("real client screens never import the demo auth provider", () => {
    for (const f of [...files, "src/app/client/bookings/BookingsView.tsx", "src/app/client/bookings/page.tsx"]) {
      const src = read(f);
      expect(src).not.toMatch(/DemoAuthProvider/);
      expect(src).not.toMatch(/useClientAuth/);
      expect(src).not.toMatch(/features\/publicBooking\/myBookings/);
    }
  });
  it("login/signup pages sanitize ?redirect= before it reaches the form", () => {
    for (const k of ["login", "signup"]) {
      expect(read(`src/app/client/${k}/page.tsx`)).toMatch(/sanitizeClientRedirect\(/);
    }
  });
});

describe("demo bookings only under ?demo=1", () => {
  it("page renders the demo view only behind demo === '1' and real data otherwise", () => {
    const src = read("src/app/client/bookings/page.tsx");
    expect(src).toMatch(/demo === "1"/);
    expect(src).toMatch(/loadMyBookingsForPage/);
    expect(read("src/app/client/bookings/BookingsView.tsx")).not.toMatch(/DemoBookingsView/);
    expect(read("src/app/client/bookings/DemoBookingsView.tsx")).toMatch(/useClientAuth/);
  });
  it("no confirm()/alert() on the real bookings screen", () => {
    expect(read("src/app/client/bookings/BookingsView.tsx")).not.toMatch(/window\.confirm|\balert\(|[^.]confirm\(/);
  });
});

describe("booking success screen branches", () => {
  const src = read("src/app/book/[workspaceSlug]/BookingWizard.tsx");
  it("linked -> My bookings; pending -> sign up/sign in with fixed redirect; otherwise no account promise", () => {
    expect(src).toMatch(/result\.claim === "linked"/);
    expect(src).toMatch(/result\.claim === "pending"/);
    expect(src).toMatch(/clientAuthHref\("signup"\)/);
    expect(src).toMatch(/clientAuthHref\("login"\)/);
    // the old unconditional "create an account" promise is gone
    expect(src).not.toMatch(/\/client\/signup\?redirect=\/client\/bookings/);
    expect(src).not.toMatch(/client\.createAccountPrompt/);
  });
  it("never puts the booking id, e-mail or token into an account URL", () => {
    const branch = src.slice(src.indexOf('result.claim === "linked"'), src.indexOf('step === "details"'));
    expect(branch).not.toMatch(/appointmentId|email|token/i);
  });
});

describe("i18n: new client-account strings exist in all four locales", () => {
  const locales = { en, de, uk, ru };
  it("client and booking blocks have identical key sets", () => {
    for (const block of ["client", "booking"] as const) {
      const ref = Object.keys(en[block]).sort();
      for (const [name, dict] of Object.entries(locales)) {
        expect(Object.keys(dict[block]).sort(), `${block} in ${name}`).toEqual(ref);
      }
    }
  });
  it("every new key is non-empty and every error code has a message", () => {
    const codes: ClientActionErrorCode[] = [
      "unauthenticated", "invalid_input", "not_found", "not_manageable", "slot_unavailable", "rate_limited", "unavailable", "unknown",
    ];
    for (const dict of Object.values(locales)) {
      for (const code of codes) expect(dict.client[clientErrorKey(code)].length).toBeGreaterThan(0);
      for (const key of ["checkEmailTitle", "checkEmailBody", "guestNote", "signedOutBody"] as const) {
        expect(dict.client[key].length).toBeGreaterThan(0);
      }
      expect(dict.booking.claimPendingBody.length).toBeGreaterThan(0);
      expect(dict.booking.claimLinkedNote.length).toBeGreaterThan(0);
    }
  });
  it("authErrors cover every business AuthErrorCode used by the client forms", () => {
    for (const dict of Object.values(locales)) {
      for (const code of ["invalid_input", "invalid_credentials", "email_taken", "weak_password", "rate_limited", "not_configured", "unknown"]) {
        expect(Object.keys(dict.authErrors)).toContain(code);
      }
    }
  });
});

describe("my bookings presentation", () => {
  const base: MyBooking = {
    id: "1", workspaceSlug: "w", businessName: "B", timezone: "Europe/Berlin",
    startsAt: "2030-01-02T10:00:00Z", endsAt: "2030-01-02T11:00:00Z", date: "2030-01-02", time: "11:00", endTime: "12:00",
    status: "confirmed", serviceId: null, serviceName: "S", staffId: null, staffName: null, resourceId: null,
    price: 0, currency: "EUR", isUpcoming: true, canCancel: true, canReschedule: true,
  };
  it("splits upcoming vs past/cancelled", () => {
    const cancelled = { ...base, id: "2", status: "cancelled" as const };
    const old = { ...base, id: "3", isUpcoming: false, status: "completed" as const };
    const { upcoming, past } = splitMyBookings([base, cancelled, old]);
    expect(upcoming.map((b) => b.id)).toEqual(["1"]);
    expect(past.map((b) => b.id).sort()).toEqual(["2", "3"]);
  });
  it("maps DB statuses to badge statuses", () => {
    expect(toAppointmentStatus("no_show")).toBe("noShow");
    expect(toAppointmentStatus("checked_in")).toBe("checkedIn");
  });
});
