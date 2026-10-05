import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/data/en";
import { de } from "@/lib/i18n/data/de";
import { uk } from "@/lib/i18n/data/uk";
import { ru } from "@/lib/i18n/data/ru";

const read = (p: string) => readFileSync(p, "utf8");

const CLIENT_FACING = [
  "src/app/book/[workspaceSlug]/BookingWizard.tsx",
  "src/app/client/bookings/BookingsView.tsx",
  "src/app/client/bookings/DemoBookingsView.tsx",
];

describe("client-facing staff names use customerStaffLabel", () => {
  it.each(CLIENT_FACING)("%s uses the shared helper and never the owner-side label", (file) => {
    const src = read(file);
    expect(src).toContain("customerStaffLabel");
    expect(src).not.toContain("getStaffLabel");
    expect(src).not.toContain("youLabel");
    expect(src).not.toContain("common.you");
  });

  it("no raw staff name is printed in client-facing JSX", () => {
    for (const file of CLIENT_FACING) {
      const src = read(file);
      expect(src, file).not.toMatch(/\{\s*(?:booking|result|selectedSlot|appointment|staff)\.(?:staffName|staff|name)\s*\}/);
    }
  });

  it("the public page and embed no longer hand the owner placeholder label to the wizard", () => {
    for (const file of ["src/app/book/[workspaceSlug]/page.tsx", "src/app/book/[workspaceSlug]/embed/page.tsx"]) {
      expect(read(file)).not.toContain("youLabel");
    }
  });
});

describe("client area i18n keys exist in all four locales", () => {
  const keys = [
    "navLabel",
    "navBook",
    "navBookings",
    "bookAppointmentCta",
    "firstBookingCta",
    "specialistNeutral",
    "discoveryEmptyTitle",
    "discoveryEmptyBody",
    "discoveryDirectHint",
  ] as const;
  it.each([
    ["en", en],
    ["de", de],
    ["uk", uk],
    ["ru", ru],
  ] as const)("%s", (_name, messages) => {
    for (const key of keys) {
      const value = (messages.client as Record<string, string>)[key];
      expect(typeof value, key).toBe("string");
      expect(value.length, key).toBeGreaterThan(1);
    }
    // The neutral label must never be the placeholder itself.
    expect(messages.client.specialistNeutral.toLowerCase()).not.toBe(messages.common.you.toLowerCase());
  });
});

describe("client navigation", () => {
  it("is used by My bookings and the directory and links to Book and My bookings", () => {
    const nav = read("src/components/layout/ClientNav/ClientNav.tsx");
    expect(nav).toContain("/client/book");
    expect(nav).toContain("/client/bookings");
    expect(nav).toContain('aria-current');
    expect(nav).not.toMatch(/\/client\/(profile|account)/);
    expect(read("src/app/client/bookings/BookingsView.tsx")).toContain("<ClientNav");
    expect(read("src/app/client/book/page.tsx")).toContain("<ClientNav");
    expect(read("src/app/client/bookings/BookingsView.tsx")).toContain("/client/book");
  });
});
