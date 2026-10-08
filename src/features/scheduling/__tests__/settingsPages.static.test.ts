import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/data/en";
import { de } from "@/lib/i18n/data/de";
import { uk } from "@/lib/i18n/data/uk";
import { ru } from "@/lib/i18n/data/ru";

const settings = path.resolve(__dirname, "../../../app/(app)/[workspaceSlug]/settings");
const read = (f: string) => readFileSync(path.join(settings, f), "utf8");

const pages = [
  ["staff", "StaffView.tsx"],
  ["resources", "ResourcesView.tsx"],
  ["hours", "HoursView.tsx"],
  ["booking", "BookingView.tsx"],
] as const;

describe("scheduling settings pages", () => {
  it.each(pages)("%s page exists, has a view, SaveStatus, a discard guard and no alert()/confirm()", (dir, view) => {
    expect(existsSync(path.join(settings, dir, "page.tsx"))).toBe(true);
    const src = read(`${dir}/${view}`);
    expect(src).toContain("SaveStatus");
    expect(src).toContain("SettingsHeader");
    expect(src).toContain("useUnsavedGuard");
    expect(src).not.toMatch(/window\.(alert|confirm)\(|\balert\(|\bconfirm\(/);
    const page = read(`${dir}/page.tsx`);
    // Demo workspaces render read-only from the preset; they never reach the write services.
    expect(page).toContain("isDemoWorkspaceSlug");
  });

  it("the hub links to all four pages", () => {
    const hub = read("page.tsx");
    for (const [dir] of pages) expect(hub).toContain(`"${dir}"`);
    expect(hub).toContain("/settings/${path}");
  });

  it("server actions are demo-guarded in the services and never take the workspace from the body", () => {
    const shared = readFileSync(path.resolve(__dirname, "../../../server/services/schedulingShared.ts"), "utf8");
    expect(shared).toContain("isDemoWorkspaceSlug");
    for (const f of ["staff", "resources", "workingHours", "bookingRules"]) {
      const src = readFileSync(path.resolve(__dirname, `../../../server/actions/${f}.actions.ts`), "utf8");
      expect(src).toMatch(/^"use server";/);
      expect(src).toContain("getSession(workspaceSlug)");
      expect(src).toContain("revalidateScheduling");
    }
  });
});

function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe("i18n of the scheduling settings", () => {
  const blocks = ["staffSettings", "resourcesSettings", "hoursSettings", "bookingSettings"] as const;
  it.each(blocks)("%s has identical keys and non-empty text in de/en/uk/ru", (block) => {
    const base = keyPaths(en[block]).sort();
    expect(base.length).toBeGreaterThan(10);
    for (const dict of [de, uk, ru]) expect(keyPaths(dict[block]).sort()).toEqual(base);
    for (const dict of [en, de, uk, ru]) for (const v of Object.values(dict[block])) expect(String(v).trim()).not.toBe("");
  });

  it("hub entries exist in every locale", () => {
    for (const dict of [en, de, uk, ru]) {
      for (const k of ["staff", "resources", "hours", "booking"] as const) {
        expect(dict.settings[k].label.length).toBeGreaterThan(0);
        expect(dict.settings[k].description.length).toBeGreaterThan(0);
      }
    }
  });

  it("placeholders survive translation", () => {
    for (const dict of [de, uk, ru]) {
      expect(dict.bookingSettings.slotHint).toContain("{n}");
      expect(dict.bookingSettings.slotHint).toContain("{example}");
      expect(dict.bookingSettings.slotOption).toContain("{n}");
      expect(dict.staffSettings.deactivateTitle).toContain("{name}");
      expect(dict.resourcesSettings.deactivateTitle).toContain("{name}");
    }
  });
});
