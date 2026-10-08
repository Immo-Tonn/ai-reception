import { describe, expect, it } from "vitest";
import { getSupabaseConfig, isSupabaseConfigured, requireSupabaseConfig, SupabaseNotConfiguredError } from "../config";

describe("Supabase configuration (ENV only, nothing project-specific in code)", () => {
  it("is not configured when ENV is missing — and never throws", () => {
    expect(getSupabaseConfig({})).toBeNull();
    expect(isSupabaseConfigured({})).toBe(false);
    expect(isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_URL: "https://x.test" })).toBe(false);
    expect(isSupabaseConfigured({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBe(false);
  });

  it("requireSupabaseConfig fails with a typed error only when something truly needs the database", () => {
    expect(() => requireSupabaseConfig({})).toThrow(SupabaseNotConfiguredError);
  });

  it("normalizes the URL and trims values", () => {
    expect(getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: " https://proj.test/ ", NEXT_PUBLIC_SUPABASE_ANON_KEY: " k " })).toEqual({
      url: "https://proj.test",
      anonKey: "k",
    });
  });

  it("rejects a non-http(s) URL", () => {
    expect(getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "javascript:alert(1)", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBeNull();
    expect(getSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" })).toBeNull();
  });
});
