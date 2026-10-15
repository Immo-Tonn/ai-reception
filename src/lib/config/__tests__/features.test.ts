import { describe, expect, it } from "vitest";
import { resolveFeatureFlags } from "../features";

describe("resolveFeatureFlags", () => {
  it("unset: on in development and tests, off in production builds", () => {
    expect(resolveFeatureFlags(undefined, "development")).toEqual({ finance: true, analytics: true });
    expect(resolveFeatureFlags(undefined, "test")).toEqual({ finance: true, analytics: true });
    expect(resolveFeatureFlags(undefined, "production")).toEqual({ finance: false, analytics: false });
  });

  it("set: exactly the listed modules, case-insensitive, empty = all off", () => {
    expect(resolveFeatureFlags("Finance", "production")).toEqual({ finance: true, analytics: false });
    expect(resolveFeatureFlags(" finance , analytics ", "production")).toEqual({ finance: true, analytics: true });
    expect(resolveFeatureFlags("", "development")).toEqual({ finance: false, analytics: false });
    expect(resolveFeatureFlags("unknown", "production")).toEqual({ finance: false, analytics: false });
  });
});
