import { describe, expect, it } from "vitest";
import { buildBookingDistribution } from "../urls";

describe("booking distribution URLs", () => {
  const d = buildBookingDistribution("https://serviceos-test.invalid/", "demo-salon");

  it("every channel points at the one existing booking flow", () => {
    expect(d.bookingUrl).toBe("https://serviceos-test.invalid/book/demo-salon");
    expect(d.websiteLinkUrl.startsWith(d.bookingUrl)).toBe(true);
    expect(d.embedPageUrl).toBe("https://serviceos-test.invalid/book/demo-salon/embed");
  });

  it("the QR encodes exactly the displayed public booking URL", () => {
    expect(d.qrUrl).toBe(d.bookingUrl);
  });

  it("builds the embed snippet from the configured origin, not localhost", () => {
    expect(d.scriptSnippet).toContain('src="https://serviceos-test.invalid/embed.js"');
    expect(d.scriptSnippet).toContain('data-workspace="demo-salon"');
    expect(d.scriptSnippet).toContain('data-origin="https://serviceos-test.invalid"');
    expect(d.scriptSnippet).not.toContain("localhost");
  });

  it("escapes values placed in HTML attributes", () => {
    const evil = buildBookingDistribution("https://serviceos-test.invalid", 'x"><script>');
    expect(evil.scriptSnippet).not.toContain('"><script>');
    expect(evil.bookingUrl).toContain(encodeURIComponent('x"><script>'));
  });
});
