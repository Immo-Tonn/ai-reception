import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  EMBED_HELLO_MESSAGE,
  EMBED_RESIZE_MESSAGE,
  MAX_EMBED_HEIGHT,
  MIN_EMBED_HEIGHT,
  parseHelloMessage,
  parseResizeMessage,
  resolveParentOrigin,
  toHttpOrigin,
} from "../messages";

const frame = { name: "our iframe window" };
const other = { name: "some other window" };
const expected = { origin: "https://serviceos-test.invalid", source: frame };
const resize = (height: unknown) => ({ type: EMBED_RESIZE_MESSAGE, height });

describe("resize message validation (parent side)", () => {
  it("accepts a well-formed message from our iframe and origin", () => {
    expect(parseResizeMessage({ origin: expected.origin, source: frame, data: resize(742.2) }, expected)).toBe(743);
  });

  it("ignores another origin, even from our iframe window", () => {
    expect(parseResizeMessage({ origin: "https://evil.example", source: frame, data: resize(500) }, expected)).toBeNull();
  });

  it("ignores another window on the right origin (e.g. a different iframe)", () => {
    expect(parseResizeMessage({ origin: expected.origin, source: other, data: resize(500) }, expected)).toBeNull();
  });

  it("ignores everything when the expected source is missing (iframe not mounted)", () => {
    expect(
      parseResizeMessage({ origin: expected.origin, source: undefined, data: resize(500) }, { ...expected, source: undefined }),
    ).toBeNull();
  });

  it.each([
    ["wrong type", { type: "other", height: 500 }],
    ["no type", { height: 500 }],
    ["string height", resize("500")],
    ["NaN height", resize(NaN)],
    ["Infinity height", resize(Infinity)],
    ["null payload", null],
    ["string payload", "serviceos-booking-resize"],
  ])("rejects %s", (_name, data) => {
    expect(parseResizeMessage({ origin: expected.origin, source: frame, data }, expected)).toBeNull();
  });

  it("clamps absurd heights so a message cannot blow up the host layout", () => {
    const at = (h: number) => parseResizeMessage({ origin: expected.origin, source: frame, data: resize(h) }, expected);
    expect(at(10_000_000)).toBe(MAX_EMBED_HEIGHT);
    expect(at(-50)).toBe(MIN_EMBED_HEIGHT);
  });
});

describe("hello + parent origin (iframe side)", () => {
  it("takes the parent origin from the browser-supplied event.origin, only from window.parent", () => {
    const parent = { name: "parent" };
    expect(parseHelloMessage({ origin: "https://site.example", source: parent, data: { type: EMBED_HELLO_MESSAGE } }, parent)).toBe(
      "https://site.example",
    );
    expect(parseHelloMessage({ origin: "https://site.example", source: other, data: { type: EMBED_HELLO_MESSAGE } }, parent)).toBeNull();
    expect(parseHelloMessage({ origin: "null", source: parent, data: { type: EMBED_HELLO_MESSAGE } }, parent)).toBeNull();
    expect(parseHelloMessage({ origin: "https://site.example", source: parent, data: { type: "x" } }, parent)).toBeNull();
  });

  it("never invents a wildcard: unknown parent => null (wait for hello)", () => {
    expect(resolveParentOrigin({ ancestorOrigins: [], referrer: "" })).toBeNull();
    expect(resolveParentOrigin({})).toBeNull();
    expect(resolveParentOrigin({ ancestorOrigins: ["https://site.example"] })).toBe("https://site.example");
    expect(resolveParentOrigin({ referrer: "https://site.example/page?x=1" })).toBe("https://site.example");
  });

  it("rejects non-http(s) origins", () => {
    expect(toHttpOrigin("javascript:alert(1)")).toBeNull();
    expect(toHttpOrigin("file:///etc/passwd")).toBeNull();
    expect(toHttpOrigin("null")).toBeNull();
  });
});

describe("public/embed.js stays in sync with the protocol", () => {
  const source = readFileSync(path.resolve(__dirname, "../../../../public/embed.js"), "utf8");

  it("uses the same message names and validates origin + source", () => {
    expect(source).toContain(EMBED_RESIZE_MESSAGE);
    expect(source).toContain(EMBED_HELLO_MESSAGE);
    expect(source).toContain("event.origin !== frameOrigin");
    expect(source).toContain("event.source !== activeIframe.contentWindow");
  });

  it('never broadcasts to "*"', () => {
    expect(source).not.toMatch(/postMessage\([^)]*["']\*["']/);
  });

  it("has localized default labels and no fixed 640px frame", () => {
    for (const label of ["Termin buchen", "Записатися", "Записаться", "Book an appointment"]) {
      expect(source).toContain(label);
    }
    expect(source).not.toContain("height:640px");
  });
});
