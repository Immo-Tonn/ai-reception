import { describe, expect, it } from "vitest";
import { addClaimToken, parseClaimCookie, serializeClaims } from "../claimCookie";
import { safeClientRedirect } from "../safeRedirect";

const T = (c: string) => c.repeat(64);

describe("claim cookie", () => {
  it("round-trips valid tokens, caps at 5 (newest kept), dedupes", () => {
    let tokens: string[] = [];
    for (const c of "abcdef0") tokens = addClaimToken(tokens, T(c));
    expect(tokens).toEqual(["c", "d", "e", "f", "0"].map(T));
    expect(addClaimToken(tokens, T("e"))).toHaveLength(5);
    expect(parseClaimCookie(serializeClaims(tokens))).toEqual(tokens);
  });
  it("ignores garbage and never throws", () => {
    for (const raw of [undefined, null, "", "not json", "{}", '"x"', "null", "[1,2]", '["zz"]', '["' + "g".repeat(64) + '"]', "[".repeat(100), "x".repeat(5000)]) {
      expect(parseClaimCookie(raw as string | undefined)).toEqual([]);
    }
    expect(parseClaimCookie(JSON.stringify([T("a"), "junk", { a: 1 }, T("b")]))).toEqual([T("a"), T("b")]);
    expect(parseClaimCookie(JSON.stringify(Array.from({ length: 20 }, (_, i) => T(String(i % 10)))))).toHaveLength(5);
  });
  it("addClaimToken refuses an invalid token", () => {
    expect(addClaimToken([], "bad")).toEqual([]);
  });
});

describe("safeClientRedirect (open redirect)", () => {
  it("accepts internal /client paths", () => {
    for (const p of ["/client", "/client/bookings", "/client/book?demo=1", "/client/bookings?x=1&y=2"]) expect(safeClientRedirect(p)).toBe(p);
  });
  it("falls back to /client for everything else", () => {
    for (const p of [
      "https://evil.test", "//evil.test", "/\\evil.test", "/\\/evil.test", "evil.test", "/client//evil.test", "/client/../login", "/clientx", "/clients",
      "/login", "/book/x", "javascript:alert(1)", "/client\r\nLocation: x", "/client%2f%2fevil", "/client@evil.test", "http://localhost/client",
      "", null, undefined, 5, {}, "/client/" + "a".repeat(300),
    ]) {
      expect(safeClientRedirect(p as string), String(p)).toBe("/client");
    }
  });
});
