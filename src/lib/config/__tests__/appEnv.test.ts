import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isStagingEnv, parseAllowedDevOrigins, resolveAppEnv } from "../appEnv";
import { en } from "@/lib/i18n/data/en";
import { de } from "@/lib/i18n/data/de";
import { uk } from "@/lib/i18n/data/uk";
import { ru } from "@/lib/i18n/data/ru";

const root = path.resolve(__dirname, "../../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("app environment marker", () => {
  it("defaults to local and never escalates on unknown values", () => {
    for (const v of [undefined, null, "", "  ", "dev", "prod", "STAGING2"]) expect(resolveAppEnv(v)).toBe("local");
  });
  it("accepts staging / production (case and whitespace tolerant)", () => {
    expect(resolveAppEnv("staging")).toBe("staging");
    expect(resolveAppEnv(" Production ")).toBe("production");
    expect(resolveAppEnv("local")).toBe("local");
  });
  it("only staging is staging", () => {
    expect(isStagingEnv("staging")).toBe(true);
    expect(isStagingEnv("production")).toBe(false);
    expect(isStagingEnv("local")).toBe(false);
  });
  it("parses ALLOWED_DEV_ORIGINS as a trimmed comma list, empty by default", () => {
    expect(parseAllowedDevOrigins(undefined)).toEqual([]);
    expect(parseAllowedDevOrigins("")).toEqual([]);
    expect(parseAllowedDevOrigins(" a.test , ,b.test ")).toEqual(["a.test", "b.test"]);
  });
});

describe("staging wiring (static)", () => {
  it("every locale has the staging badge text", () => {
    for (const m of [en, de, uk, ru]) expect(m.environment.stagingBadge.length).toBeGreaterThan(5);
  });
  it("the badge renders nothing outside staging, is non-interactive and sits at the top", () => {
    const tsx = read("src/components/layout/EnvironmentBadge/EnvironmentBadge.tsx");
    expect(tsx).toMatch(/if \(!isStagingEnv\(\)\) return null/);
    const css = read("src/components/layout/EnvironmentBadge/EnvironmentBadge.module.css");
    expect(css).toMatch(/pointer-events:\s*none/);
    expect(css).toMatch(/safe-area-inset-top/);
    expect(css).not.toMatch(/\bbottom\s*:/);
  });
  it("root layout mounts the badge and sets noindex + metadataBase", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/<EnvironmentBadge \/>/);
    expect(layout).toMatch(/index: false, follow: false/);
    expect(layout).toMatch(/metadataBase/);
  });
  it("next.config sends X-Robots-Tag only for staging and no longer hard-codes a LAN IP", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/isStagingEnv\(\)[\s\S]*X-Robots-Tag[\s\S]*noindex, nofollow/);
    expect(cfg).not.toMatch(/\b192\.168\.\d+\.\d+/);
    expect(cfg).toMatch(/ALLOWED_DEV_ORIGINS/);
  });
});
