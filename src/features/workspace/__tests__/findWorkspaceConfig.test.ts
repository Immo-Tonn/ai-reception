import { describe, expect, it } from "vitest";
import { findWorkspaceConfig, getWorkspaceConfig } from "../registry";

describe("workspace lookup for public routes", () => {
  it("does not fall back to Salon for an unknown slug", () => {
    expect(findWorkspaceConfig("totally-unknown-xyz")).toBeUndefined();
    expect(findWorkspaceConfig("book")).toBeUndefined();
    expect(findWorkspaceConfig("demo")).toBeUndefined();
  });

  it.each(["demo-salon", "demo-werkstatt", "demo-cleaning", "demo-consulting"])(
    "still resolves the demo workspace %s",
    (slug) => {
      expect(findWorkspaceConfig(slug)?.slug).toBe(slug);
    },
  );

  it("the authenticated app shell keeps its demo fallback", () => {
    expect(getWorkspaceConfig("totally-unknown-xyz").slug).toBe("demo-salon");
  });
});
