import { describe, expect, it } from "vitest";
import { findWorkspaceConfig, getWorkspaceConfig, isDemoWorkspaceSlug } from "../registry";

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

  it("a real workspace gets an empty config, never Salon's demo data", () => {
    const config = getWorkspaceConfig("totally-unknown-xyz");
    expect(config.slug).toBe("totally-unknown-xyz");
    expect(config.clients).toEqual([]);
    expect(config.appointments).toEqual([]);
    expect(config.services).toEqual([]);
  });

  it("tells demo workspaces apart from real ones", () => {
    expect(isDemoWorkspaceSlug("demo-salon")).toBe(true);
    expect(isDemoWorkspaceSlug("my-real-salon")).toBe(false);
  });
});
