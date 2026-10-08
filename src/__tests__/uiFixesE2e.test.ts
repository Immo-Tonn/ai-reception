import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/data/en";
import { de } from "@/lib/i18n/data/de";
import { uk } from "@/lib/i18n/data/uk";
import { ru } from "@/lib/i18n/data/ru";

const read = (p: string) => readFileSync(p, "utf8");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const LOCALES = { en, de, uk, ru } as const;

// "Only in this browser" is true ONLY for demo data. These keys are demo-only and may say so.
const DEMO_ONLY_KEYS = new Set(["client.demoDataNote", "client.demoBookingsNote", "booking.demoNote"]);
// "…in this browser" for claiming a guest booking is about the session, not data storage.
const SESSION_KEYS = new Set(["client.claimPendingBody"]);
const BROWSER_ONLY = [
  /only in this browser/i,
  /this browser only/i,
  /nur in diesem Browser/i,
  /лише в цьому браузері/i,
  /тільки в цьому браузері/i,
  /только в этом браузере/i,
];

function flatten(obj: unknown, prefix = ""): Array<[string, string]> {
  if (typeof obj === "string") return [[prefix, obj]];
  if (obj && typeof obj === "object") {
    return Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

describe("stale local-only workspace banner", () => {
  it("workspaceNotice no longer exists in any locale or in the app layout", () => {
    for (const m of Object.values(LOCALES)) expect(m).not.toHaveProperty("workspaceNotice");
    const layout = read("src/app/(app)/[workspaceSlug]/layout.tsx");
    expect(layout).not.toMatch(/workspaceNotice|localOnlyNotice/);
    expect(read("src/app/(app)/[workspaceSlug]/layout.module.css")).not.toMatch(/localOnlyNotice/);
  });

  it("no string says data lives only in this browser, except explicit demo-only keys", () => {
    for (const [locale, m] of Object.entries(LOCALES)) {
      for (const [key, text] of flatten(m)) {
        if (DEMO_ONLY_KEYS.has(key) || SESSION_KEYS.has(key)) continue;
        for (const re of BROWSER_ONLY) {
          expect(re.test(text), `${locale}:${key} -> ${text}`).toBe(false);
        }
      }
    }
  });

  it("demo-only keys exist in every locale and are a subset of the allow-list", () => {
    for (const m of Object.values(LOCALES)) {
      const keys = new Set(flatten(m).map(([k]) => k));
      for (const k of ["client.demoDataNote", "client.demoBookingsNote"]) expect(keys.has(k)).toBe(true);
    }
  });
});

describe("public booking mobile layout (CSS regression)", () => {
  const css = read("src/app/book/[workspaceSlug]/page.module.css");
  const rule = (sel: string) => {
    const m = css.match(new RegExp(`(^|\\n)${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
    return m ? m[2] : "";
  };

  it(".page is a flex column with 100vh fallback then 100dvh", () => {
    const body = rule(".page");
    expect(body).toMatch(/min-height:\s*100vh;\s*min-height:\s*100dvh/);
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
  });

  it(".screen has no viewport-height of its own and grows with flex", () => {
    const body = rule(".screen");
    expect(body).not.toMatch(/100vh|100dvh|100svh/);
    expect(body).not.toMatch(/(^|[^-])height:\s*100/);
    expect(body).toMatch(/flex:\s*1/);
    expect(rule(".screenEmbedded")).not.toMatch(/100d?vh/);
  });

  it("never uses height: 100vh anywhere", () => {
    expect(css).not.toMatch(/[^-]height:\s*100vh/);
  });

  it("standalone page puts the wizard and PublicFooter in the same .page container; embed has no footer", () => {
    const page = read("src/app/book/[workspaceSlug]/page.tsx");
    expect(page).toMatch(/<div className=\{styles\.page\}>[\s\S]*<BookingWizard[\s\S]*<PublicFooter \/>[\s\S]*<\/div>/);
    const embed = read("src/app/book/[workspaceSlug]/embed/page.tsx");
    expect(embed).not.toMatch(/PublicFooter/);
    expect(embed).toMatch(/chromeless/);
  });

  it("safe-area insets are honoured (top header, bottom action bar, footer)", () => {
    expect(css).toMatch(/safe-area-inset-top/);
    expect(css).toMatch(/safe-area-inset-bottom/);
    expect(read("src/components/layout/PublicFooter/PublicFooter.module.css")).toMatch(/safe-area-inset-bottom/);
  });

  it("touch targets: step back, time slots and option cards are >= 44px", () => {
    expect(rule(".stepBack")).toMatch(/min-height:\s*44px/);
    expect(Number(rule(".timeSlot").match(/height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(44);
    expect(Number(rule(".optionCard").match(/min-height:\s*(\d+)px/)?.[1])).toBeGreaterThanOrEqual(44);
    expect(rule(".dateStrip")).toMatch(/gap:/);
    expect(rule(".timeGrid")).toMatch(/gap:/);
  });
});

describe("client / booking screens: no hard-coded English UI text", () => {
  const files = [...walk("src/app/client"), ...walk("src/app/book")].filter((f) => f.endsWith(".tsx"));

  it("JSX text nodes and a11y/placeholder attributes are not English literals", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = read(f);
      // JSX text between tags: at least two English words, no braces.
      for (const m of src.matchAll(/>\s*([A-Z][a-z]+(?:\s+[A-Za-z]+)+)\s*</g)) {
        if (!/[{}=;()]/.test(m[1]!)) offenders.push(`${f}: text "${m[1]}"`);
      }
      for (const m of src.matchAll(/\b(?:aria-label|placeholder|title|alt)="([^"{}]+)"/g)) {
        if (/^[A-Z][a-z]+(\s+\w+)*$/.test(m[1]!) && !/^[A-Z][a-z]*$/.test(m[1]!)) offenders.push(`${f}: attr "${m[1]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("staff label \"You\" stored in data never reaches a client: shared customerStaffLabel in My Bookings, wizard and demo view", () => {
    for (const f of [
      "src/app/client/bookings/BookingsView.tsx",
      "src/app/client/bookings/DemoBookingsView.tsx",
      "src/app/book/[workspaceSlug]/BookingWizard.tsx",
    ]) {
      expect(read(f), f).toMatch(/customerStaffLabel\(/);
    }
    expect(read("src/app/client/bookings/BookingsView.tsx")).not.toMatch(/\$\{booking\.staffName\}/);
  });

  it("common.you is translated in every non-English locale", () => {
    expect(uk.common.you).toBe("Ви");
    expect(ru.common.you).toBe("Вы");
    expect(de.common.you).not.toBe("You");
    expect(en.common.you).toBe("You");
  });
});
