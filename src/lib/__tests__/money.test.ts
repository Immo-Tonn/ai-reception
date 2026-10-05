import { describe, expect, it } from "vitest";
import {
  MoneyError,
  formatMinor,
  fromMinor,
  lineTotalMinor,
  linesTotalMinor,
  minorToDecimalString,
  sumMinor,
  toMinor,
  toQuantityMilli,
} from "../money";

describe("toMinor / fromMinor (decimal based, no float drift)", () => {
  it("parses common amounts exactly", () => {
    expect(toMinor(19.99)).toBe(1999);
    expect(toMinor("19,99")).toBe(1999);
    expect(toMinor(0.1)).toBe(10);
    expect(toMinor(1.1)).toBe(110);
    expect(toMinor(0)).toBe(0);
    expect(toMinor("  7 ")).toBe(700);
    expect(toMinor(-2.5)).toBe(-250);
  });

  it("rounds half-up on the third decimal (1.005 is 1.01, which x*100 gets wrong)", () => {
    expect(toMinor(1.005)).toBe(101);
    expect(toMinor("2.675")).toBe(268);
    expect(toMinor("2.674")).toBe(267);
    expect(toMinor(-1.005)).toBe(-101); // half away from zero
    expect(Math.round(1.005 * 100)).toBe(100); // the float trap this module avoids
  });

  it("handles exponent notation and rejects garbage", () => {
    expect(toMinor(1e-7)).toBe(0);
    expect(toMinor(1e9)).toBe(100_000_000_000);
    expect(() => toMinor(Number.NaN)).toThrow(MoneyError);
    expect(() => toMinor(Infinity)).toThrow(MoneyError);
    expect(() => toMinor("12abc")).toThrow(MoneyError);
    expect(() => toMinor("")).toThrow(MoneyError);
  });

  it("round-trips whole cents", () => {
    for (const cents of [0, 1, 9, 10, 99, 100, 101, 12345, 99999999]) {
      expect(toMinor(fromMinor(cents))).toBe(cents);
    }
    expect(() => fromMinor(1.5)).toThrow(MoneyError);
  });

  it("minorToDecimalString is what numeric(12,2) receives", () => {
    expect(minorToDecimalString(0)).toBe("0.00");
    expect(minorToDecimalString(5)).toBe("0.05");
    expect(minorToDecimalString(1999)).toBe("19.99");
    expect(minorToDecimalString(-250)).toBe("-2.50");
  });
});

describe("sums are exact integer additions", () => {
  it("0.1 + 0.2 is exactly 0.30 (floats give 0.30000000000000004)", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(fromMinor(sumMinor([toMinor(0.1), toMinor(0.2)]))).toBe(0.3);
    expect(sumMinor([toMinor(0.1), toMinor(0.2)])).toBe(30);
  });

  it("a hundred cents add to one euro", () => {
    expect(sumMinor(Array.from({ length: 100 }, () => toMinor(0.01)))).toBe(100);
    expect(Array.from({ length: 100 }, () => 0.01).reduce((a, b) => a + b, 0)).not.toBe(1);
  });

  it("refuses non-integers", () => {
    expect(() => sumMinor([1, 1.5])).toThrow(MoneyError);
  });
});

describe("line totals: quantity x price, rounded half-up once per line", () => {
  it("quantity decimals", () => {
    expect(lineTotalMinor(1.5, 19.99)).toBe(2999); // 29.985 -> 29.99
    expect(lineTotalMinor("0.25", 10)).toBe(250);
    expect(lineTotalMinor(3, 0.1)).toBe(30);
    expect(lineTotalMinor("1.005", 1)).toBe(101);
    expect(lineTotalMinor("0.333", 10)).toBe(333);
    expect(lineTotalMinor(0, 10)).toBe(0);
  });

  it("three lines: the total is the sum of ROUNDED lines (matches invoices.amount in the database)", () => {
    const lines = [
      { quantity: "1.500", unitPrice: "19.99" }, // 29.99
      { quantity: "1.005", unitPrice: "1.00" }, //  1.01
      { quantity: "1.005", unitPrice: "1.00" }, //  1.01
    ];
    expect(linesTotalMinor(lines)).toBe(3201);
    // rounding the unrounded sum (32.005) would have given 3201 only by luck; per-line rounding is the rule
    expect(lineTotalMinor(1.5, 19.99) + lineTotalMinor(1.005, 1) * 2).toBe(3201);
  });

  it("quantity helper keeps 3 decimals", () => {
    expect(toQuantityMilli("2.5")).toBe(2500);
    expect(toQuantityMilli(0.0004)).toBe(0);
    expect(toQuantityMilli(0.0005)).toBe(1);
  });

  it("an empty invoice is zero", () => {
    expect(linesTotalMinor([])).toBe(0);
  });
});

describe("formatMinor", () => {
  it("formats through Intl with the currency", () => {
    expect(formatMinor(123456, "EUR", "en-US")).toBe("€1,234.56");
    expect(formatMinor(5, "USD", "en-US")).toBe("$0.05");
  });
});
