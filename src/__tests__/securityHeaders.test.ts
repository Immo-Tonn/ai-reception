import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("framing headers", async () => {
  const rules = (await nextConfig.headers?.()) ?? [];
  const headerMap = (source: string) =>
    Object.fromEntries((rules.find((r) => r.source === source)?.headers ?? []).map((h) => [h.key, h.value]));

  it("ordinary pages can only be framed by ServiceOS itself", () => {
    const general = rules.find((r) => r.source.startsWith("/:path"))!;
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
});
