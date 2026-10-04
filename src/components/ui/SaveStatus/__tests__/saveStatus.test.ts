import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(p, "utf8");

describe("save feedback pattern", () => {
  const component = src("src/components/ui/SaveStatus/SaveStatus.tsx");

  it("covers every state with an accessible live region and never uses alert()", () => {
    for (const state of ["dirty", "saving", "saved", "error"]) expect(component).toContain(`"${state}"`);
    expect(component).toContain('role="alert"');
    expect(component).toContain('role="status"');
    expect(component).not.toMatch(/\balert\(/);
  });

  it("the saved confirmation expires on its own", () => {
    expect(component).toMatch(/setTimeout\(onSavedExpire/);
  });

  it("uses theme tokens only (works in both themes), no hard-coded colours", () => {
    expect(src("src/components/ui/SaveStatus/SaveStatus.module.css")).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it("business profile and services forms use the shared component", () => {
    expect(src("src/app/(app)/[workspaceSlug]/settings/business/BusinessProfileView.tsx")).toContain("<SaveStatus");
    expect(src("src/app/(app)/[workspaceSlug]/settings/services/ServicesView.tsx")).toContain("<SaveStatus");
  });

  it("all four locales define the three labels", () => {
    for (const l of ["en", "de", "uk", "ru"]) {
      expect(src(`src/lib/i18n/data/${l}.ts`)).toMatch(/saveStatus: \{ unsaved: "[^"]+", saving: "[^"]+", saved: "[^"]+" \}/);
    }
  });
});
