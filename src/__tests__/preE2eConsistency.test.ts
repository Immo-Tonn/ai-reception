import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
const grep = (pattern: string, ...dirs: string[]) => {
  try {
    return execSync(`git grep -n -E ${JSON.stringify(pattern)} -- ${dirs.map((d) => JSON.stringify(d)).join(" ")}`, { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((l) => l && !l.includes("__tests__"));
  } catch {
    return [];
  }
};

describe("one business day everywhere (workspace timezone)", () => {
  it("Today and Calendar derive the day from the same workspace-aware helper", () => {
    expect(read("src/app/(app)/[workspaceSlug]/today/TodayView.tsx")).toContain("useWorkspaceToday");
    expect(read("src/app/(app)/[workspaceSlug]/calendar/CalendarView.tsx")).toContain("useWorkspaceToday");
  });

  it("the business app never derives a calendar day from UTC or the browser clock", () => {
    // `toISOString().slice(0, 10)` is the UTC date; `localIsoDate(new Date())` is the browser's date.
    const offenders = grep("toISOString\\(\\)\\.slice\\(0, ?10\\)|localIsoDate\\(new Date\\(\\)\\)", "src/app/(app)", "src/server/services", "src/features/work", "src/features/finance");
    expect(offenders).toEqual([]);
  });

  it("public booking builds its calendar from the business timezone", () => {
    const wizard = read("src/app/book/[workspaceSlug]/BookingWizard.tsx");
    expect(wizard).toMatch(/timezone|timeZone/);
    expect(wizard).not.toMatch(/toISOString\(\)\.slice\(0, ?10\)/);
  });
});

describe("navigation keeps the workspace", () => {
  it("every bottom-nav and quick-create link is built from the current workspace base", () => {
    const nav = read("src/components/layout/BottomNav/BottomNav.tsx");
    const quick = read("src/components/layout/BottomNav/QuickCreateSheet.tsx");
    expect(nav).toMatch(/href=\{`\$\{base\}\//);
    expect([...quick.matchAll(/href: `([^`]+)`/g)].map((m) => m[1])).toEqual([
      "${base}/calendar?create=appointment",
      "${base}/clients?create=client",
      "${base}/finance?create=invoice",
    ]);
  });

  it("each create target page reads its ?create= parameter", () => {
    expect(read("src/app/(app)/[workspaceSlug]/calendar/CalendarView.tsx")).toContain("create");
    expect(read("src/app/(app)/[workspaceSlug]/clients/ClientsView.tsx")).toContain("create");
    expect(read("src/app/(app)/[workspaceSlug]/finance/FinanceView.tsx")).toContain("create");
  });
});

describe("demo and real workspaces stay apart", () => {
  it("real workspaces get empty seeds and never a demo config", () => {
    const registry = read("src/features/workspace/registry.ts");
    expect(registry).toMatch(/emptyWorkspaceConfig/);
    expect(registry).toMatch(/bySlug\.get\(workspaceSlug\) \?\? emptyWorkspaceConfig/);
  });

  it("the real client directory never imports demo presets; demo only behind ?demo=1", () => {
    const page = read("src/app/client/book/page.tsx");
    expect(page).toMatch(/showDemo \? demoWorkspaces : \[\]/);
    expect(read("src/server/booking/discovery.service.ts")).not.toMatch(/workspace\/registry|demoWorkspaces/);
  });

  it("the workspace layout gates real workspaces behind membership (404 / login)", () => {
    const layout = read("src/app/(app)/[workspaceSlug]/layout.tsx");
    expect(layout).toMatch(/notFound\(\)/);
    expect(layout).toMatch(/redirect\("\/login"\)/);
  });
});
