/**
 * Money in INTEGER MINOR UNITS (cents). The one shared helper for every amount in ServiceOS.
 *
 * Rules
 * - Never add, subtract or multiply floating-point amounts. Convert to minor units first (`toMinor`),
 *   do the arithmetic on integers, convert back for display or storage (`fromMinor`).
 * - Parsing is DECIMAL based (the shortest decimal text of the number), not `x * 100`, so 1.005 is
 *   1.01 and 0.1 + 0.2 is exactly 0.30.
 * - Rounding is HALF-UP (half away from zero for negatives), applied ONCE per line
 *   (`lineTotalMinor`); sums are exact integer additions.
 * - Quantities carry up to 3 decimals (0.25 h, 1.5 kg); prices and totals 2 decimals. These match the
 *   database columns `invoice_items.quantity numeric(12,3)`, `unit_price numeric(12,2)`,
 *   `invoices.amount numeric(12,2)` and the SQL line total `round(quantity * unit_price, 2)`.
 * - Currency is an ISO 4217 code. All currencies handled here use 2 minor digits (EUR, USD, GBP, CHF,
 *   UAH, PLN ...); zero-decimal currencies are not supported yet.
 */

export const MINOR_DIGITS = 2;
const MINOR_FACTOR = 100;
const QTY_DIGITS = 3;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Decimal text of a finite number without exponent notation. */
function plainDecimal(value: number | string): string {
  if (typeof value === "string") {
    const text = value.trim().replace(",", ".");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(text)) throw new MoneyError(`Not a decimal amount: "${value}"`);
    return text;
  }
  if (!Number.isFinite(value)) throw new MoneyError("Amount must be a finite number");
  const text = String(value);
  if (!/e/i.test(text)) return text;
  // exponent form (very small / very large): fall back to a fixed expansion
  return value.toFixed(12).replace(/\.?0+$/, "") || "0";
}

/** Decimal text -> integer scaled by 10^digits, rounded half away from zero. */
function scaleDecimal(text: string, digits: number): bigint {
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [intPartRaw, fracRaw = ""] = unsigned.split(".");
  const intPart = intPartRaw === "" ? "0" : intPartRaw;
  const frac = fracRaw.padEnd(digits + 1, "0");
  let scaled = BigInt(intPart + frac.slice(0, digits));
  if (frac.charCodeAt(digits) >= 53 /* '5' */) scaled += BigInt(1); // half-up on the first dropped digit
  return negative ? -scaled : scaled;
}

function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new MoneyError("Amount out of range");
  return n;
}

/** Major units (19.99 or "19,99") -> integer cents (1999). Half-up. */
export function toMinor(amount: number | string): number {
  return toSafeNumber(scaleDecimal(plainDecimal(amount), MINOR_DIGITS));
}

/** Integer cents -> major units. The result is exact to 2 decimals (for storage / display only). */
export function fromMinor(minor: number): number {
  if (!Number.isInteger(minor)) throw new MoneyError("Minor amount must be an integer");
  return Number((minor / MINOR_FACTOR).toFixed(MINOR_DIGITS));
}

/** Decimal text ("19.99") of an integer minor amount; what is sent to numeric(12,2) columns. */
export function minorToDecimalString(minor: number): string {
  if (!Number.isInteger(minor)) throw new MoneyError("Minor amount must be an integer");
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / MINOR_FACTOR);
  const cents = String(abs % MINOR_FACTOR).padStart(MINOR_DIGITS, "0");
  return `${negative ? "-" : ""}${whole}.${cents}`;
}

/** Exact integer sum. */
export function sumMinor(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    if (!Number.isInteger(v)) throw new MoneyError("Minor amount must be an integer");
    total += v;
  }
  if (!Number.isSafeInteger(total)) throw new MoneyError("Amount out of range");
  return total;
}

/** Quantity (up to 3 decimals) -> thousandths. */
export function toQuantityMilli(quantity: number | string): number {
  return toSafeNumber(scaleDecimal(plainDecimal(quantity), QTY_DIGITS));
}

/**
 * Line total in minor units: quantity x unit price, rounded half-up ONCE.
 * Identical to the database's `round(quantity * unit_price, 2)` for non-negative values.
 */
export function lineTotalMinor(quantity: number | string, unitPrice: number | string): number {
  const qtyMilli = BigInt(toQuantityMilli(quantity));
  const unitMinor = BigInt(toMinor(unitPrice));
  const product = qtyMilli * unitMinor;
  const half = BigInt(500);
  const thousand = BigInt(1000);
  const negative = product < BigInt(0);
  const abs = negative ? -product : product;
  const rounded = (abs + half) / thousand;
  return toSafeNumber(negative ? -rounded : rounded);
}

export interface MoneyLine {
  quantity: number | string;
  unitPrice: number | string;
}

/** Sum of per-line rounded totals, in minor units. This is what `invoices.amount` always equals. */
export function linesTotalMinor(lines: readonly MoneyLine[]): number {
  return sumMinor(lines.map((l) => lineTotalMinor(l.quantity, l.unitPrice)));
}

/** Locale-aware currency text for an integer minor amount. */
export function formatMinor(minor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(fromMinor(minor));
}
