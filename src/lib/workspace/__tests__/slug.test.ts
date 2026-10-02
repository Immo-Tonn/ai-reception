import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEMO_SLUG_PREFIX, isSlugAllowed, RESERVED_SLUGS } from "../reservedSlugs";
import { slugify } from "../slug";

describe("slugify", () => {
  it.each([
    ["Anna's Beauty Studio", "anna-s-beauty-studio"],
    ["Müller & Söhne", "mueller-soehne"],
    ["Салон Красоты", "salon-krasoty"],
    ["Перукарня «Ґанок»", "perukarnya-ganok"],
    ["  ---  ", "workspace"],
    ["!!!", "workspace"],
    ["Café Crème", "cafe-creme"],
  ])("%s -> %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("caps the length without leaving a trailing dash", () => {
    const slug = slugify("a".repeat(30) + " " + "b".repeat(40));
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("reserved slugs", () => {
  it("rejects static routes, demo workspaces and malformed slugs", () => {
    for (const bad of ["book", "login", "signup", "client", "business", "onboarding", "embed-demo", "api", "demo-salon", "demo-anything", "ab", "Has-Caps", "-x-", "a--b", "x".repeat(61)]) {
      expect(isSlugAllowed(bad), bad).toBe(false);
    }
  });

  it("accepts ordinary business slugs", () => {
    for (const ok of ["anna-beauty", "salon-123", "mueller-soehne", "bookkeeping-pro"]) {
      expect(isSlugAllowed(ok), ok).toBe(true);
    }
  });

  it("TypeScript list and SQL function (migration 0008) are identical — no drift", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/0008_workspace_hardening.sql"), "utf8");
    const block = sql.match(/array\[([\s\S]*?)\]/)![1];
    const sqlList = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect([...RESERVED_SLUGS].sort()).toEqual(sqlList);
    expect(sql).toContain(`not like '${DEMO_SLUG_PREFIX}%'`);
  });
});
