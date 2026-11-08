import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("framing headers", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const headerMap = (source: string) =>
    Object.fromEntries((rules.find((r) => r.source === source)?.headers ?? []).map((h) => [h.key, h.value]));

  it("ordinary pages can only be framed by ServiceOS itself", () => {
    const general = rules.find((r) => r.source.startsWith("/:path") && r.headers.some((h) => h.key === "X-Frame-Options"))!;
    const map = Object.fromEntries(general.headers.map((h) => [h.key, h.value]));
    expect(map["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
    expect(map["X-Frame-Options"]).toBe("SAMEORIGIN");
    // The pattern must exclude the embed route, so the two rules never overlap.
    expect(general.source).toContain("(?!book/[^/]+/embed$)");
  });

  it("the booking embed is frameable anywhere and has NO X-Frame-Options", () => {
    const map = headerMap("/book/:workspaceSlug/embed");
    expect(map["Content-Security-Policy"]).toBe("frame-ancestors *");
    expect(map["X-Frame-Options"]).toBeUndefined();
  });

  it("every response gets the baseline headers, and /connect-calendar keeps no-referrer", () => {
    const baseIndex = rules.findIndex((r) => r.source === "/:path*" && r.headers.some((h) => h.key === "X-Content-Type-Options"));
    expect(baseIndex).toBeGreaterThanOrEqual(0);
    const base = Object.fromEntries(rules[baseIndex].headers.map((h) => [h.key, h.value]));
    expect(base["X-Content-Type-Options"]).toBe("nosniff");
    expect(base["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(base["Permissions-Policy"]).toContain("camera=()");
    // Next.js: for the same key the LAST matching rule wins -> the connect pages must come later.
    const connectIndex = rules.findIndex((r) => r.source === "/connect-calendar/:path*");
    expect(connectIndex).toBeGreaterThan(baseIndex);
    expect(headerMap("/connect-calendar/:path*")["Referrer-Policy"]).toBe("no-referrer");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
