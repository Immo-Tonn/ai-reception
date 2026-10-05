import { describe, expect, it } from "vitest";
import { normalizeBaseUrl, resolvePublicBaseUrl } from "../publicBaseUrl";

describe("public base URL", () => {
  it("prefers NEXT_PUBLIC_APP_URL and normalizes it to an origin", () => {
    expect(resolvePublicBaseUrl({ NEXT_PUBLIC_APP_URL: "https://serviceos-test.invalid/some/path/", NODE_ENV: "production" })).toEqual({
      baseUrl: "https://serviceos-test.invalid",
      source: "env",
    });
  });

  it("falls back to the Vercel PRODUCTION domain, not a preview URL", () => {
    expect(resolvePublicBaseUrl({ VERCEL_PROJECT_PRODUCTION_URL: "serviceos.example.app", NODE_ENV: "production" })).toEqual({
      baseUrl: "https://serviceos.example.app",
      source: "vercel-production",
    });
  });

  it("falls back to the Vercel deployment URL (host only → https added)", () => {
    expect(resolvePublicBaseUrl({ VERCEL_URL: "my-deploy-abc123.vercel.app", NODE_ENV: "production" })).toEqual({
      baseUrl: "https://my-deploy-abc123.vercel.app",
      source: "vercel-deployment",
    });
  });

  it("explicit config beats production domain, which beats the deployment URL", () => {
    const env = {
      NEXT_PUBLIC_APP_URL: "https://custom.invalid",
      VERCEL_PROJECT_PRODUCTION_URL: "prod.invalid",
      VERCEL_URL: "deploy.invalid",
      NODE_ENV: "production",
    };
    expect(resolvePublicBaseUrl(env).baseUrl).toBe("https://custom.invalid");
    expect(resolvePublicBaseUrl({ ...env, NEXT_PUBLIC_APP_URL: undefined }).baseUrl).toBe("https://prod.invalid");
    expect(resolvePublicBaseUrl({ ...env, NEXT_PUBLIC_APP_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined }).baseUrl).toBe("https://deploy.invalid");
  });

  it("on a Vercel PREVIEW the deployment URL beats the production domain (no production links from previews)", () => {
    const env = { VERCEL_PROJECT_PRODUCTION_URL: "prod.invalid", VERCEL_URL: "deploy-abc.vercel.invalid", NODE_ENV: "production" };
    expect(resolvePublicBaseUrl({ ...env, VERCEL_ENV: "preview" }).baseUrl).toBe("https://deploy-abc.vercel.invalid");
    expect(resolvePublicBaseUrl({ ...env, VERCEL_ENV: "production" }).baseUrl).toBe("https://prod.invalid");
    expect(resolvePublicBaseUrl({ ...env, VERCEL_ENV: "preview", NEXT_PUBLIC_APP_URL: "https://custom.invalid" }).baseUrl).toBe("https://custom.invalid");
  });

  it("uses the dev host only in development", () => {
    expect(resolvePublicBaseUrl({ NODE_ENV: "development" }, "localhost:3001")).toEqual({
      baseUrl: "http://localhost:3001",
      source: "dev-fallback",
    });
    expect(resolvePublicBaseUrl({ NODE_ENV: "development" }).baseUrl).toBe("http://localhost:3000");
  });

  it("a local request host (e.g. local `next start`) resolves to that localhost origin", () => {
    expect(resolvePublicBaseUrl({ NODE_ENV: "production" }, "localhost:3000")).toEqual({
      baseUrl: "http://localhost:3000",
      source: "dev-fallback",
    });
  });

  it("in production with nothing configured it refuses to guess from a non-local host", () => {
    expect(resolvePublicBaseUrl({ NODE_ENV: "production" }, "some-host.invalid")).toEqual({ baseUrl: null, source: "missing" });
    expect(resolvePublicBaseUrl({ NODE_ENV: "production" })).toEqual({ baseUrl: null, source: "missing" });
  });

  it("rejects non-http(s) and garbage values", () => {
    expect(normalizeBaseUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBaseUrl("ftp://x.example")).toBeNull();
    expect(normalizeBaseUrl("   ")).toBeNull();
    expect(resolvePublicBaseUrl({ NEXT_PUBLIC_APP_URL: "ftp://x", NODE_ENV: "production" }).baseUrl).toBeNull();
  });
});
