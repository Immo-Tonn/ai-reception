/**
 * Pure helpers for the pending-claim cookie (no Next.js import, unit-testable).
 * The cookie holds booking CLAIM TOKENS made by this browser as a guest. It is
 * httpOnly, so the tokens never reach browser JS, and they never appear in URLs.
 */
export const CLAIMS_COOKIE_NAME = "serviceos_claims";
export const CLAIMS_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const MAX_PENDING_CLAIMS = 5;

const TOKEN_RE = /^[0-9a-f]{32,128}$/;

export const isClaimToken = (value: unknown): value is string => typeof value === "string" && TOKEN_RE.test(value);

/** Garbage-tolerant: anything that is not a JSON array of valid tokens is dropped. Never throws. */
export function parseClaimCookie(raw: string | undefined | null): string[] {
  if (!raw || raw.length > 2000) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) {
    if (isClaimToken(item) && !out.includes(item)) out.push(item);
    if (out.length >= MAX_PENDING_CLAIMS) break;
  }
  return out;
}

/** Appends a token; keeps the newest MAX_PENDING_CLAIMS. */
export function addClaimToken(tokens: string[], token: string): string[] {
  if (!isClaimToken(token)) return tokens;
  return [...tokens.filter((t) => t !== token), token].slice(-MAX_PENDING_CLAIMS);
}

export const serializeClaims = (tokens: string[]): string => JSON.stringify(tokens.filter(isClaimToken).slice(-MAX_PENDING_CLAIMS));
