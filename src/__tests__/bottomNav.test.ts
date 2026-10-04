import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MORE_CHILD_SEGMENTS } from "@/components/layout/BottomNav/BottomNav";

const root = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("mobile bottom navigation", () => {
  it("More highlights for every section listed on the More page", () => {
    const more = read("app/(app)/[workspaceSlug]/more/page.tsx");
    const segments = [...more.matchAll(/segment: "([^"]+)"/g)].map((m) => m[1]);
    for (const s of segments) expect(MORE_CHILD_SEGMENTS).toContain(s);
  });

  it("derives active state from the pathname, not local state", () => {
    const src = read("components/layout/BottomNav/BottomNav.tsx");
    expect(src).toContain("usePathname");
    expect(src).toContain("aria-current");
  });

  it("uses the safe-area inset and content clears the nav", () => {
    const nav = read("components/layout/BottomNav/BottomNav.module.css");
    const layout = read("app/(app)/[workspaceSlug]/layout.module.css");
    expect(nav).toMatch(/height: calc\(60px \+ env\(safe-area-inset-bottom\)\)/);
    expect(layout).toMatch(/padding-bottom: calc\(60px \+ env\(safe-area-inset-bottom\)\)/);
  });

  it("back links in More-reachable pages have a >= 44px hit area", () => {
    const css = read("app/(app)/[workspaceSlug]/clients/[clientId]/page.module.css");
    expect(css).toMatch(/\.backLink \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.tab \{[^}]*height: 44px/);
  });
});
