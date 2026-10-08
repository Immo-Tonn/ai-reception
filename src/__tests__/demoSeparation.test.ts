import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("demo workspaces stay out of the normal flow", () => {
  it("root page does not link into a demo/unknown workspace", () => {
    expect(read("src/app/page.tsx")).not.toMatch(/href="\/demo/);
  });
  it("onboarding never falls back into a demo workspace", () => {
    expect(read("src/app/onboarding/OnboardingWizard.tsx")).not.toMatch(/push\("\/demo/);
  });
  it("client discovery lists demo businesses only behind the explicit ?demo=1 entry", () => {
    const src = read("src/app/client/book/page.tsx");
    expect(src).toMatch(/demo === "1"/);
    expect(src).toMatch(/showDemo \? demoWorkspaces : \[\]/);
  });
  it("demo presets keep their explicit demo-* slugs", () => {
    for (const f of ["salon", "werkstatt", "cleaning", "consulting"]) {
      expect(read(`src/features/workspace/presets/${f}.ts`)).toMatch(new RegExp(`slug: "demo-${f}"`));
    }
  });
});
