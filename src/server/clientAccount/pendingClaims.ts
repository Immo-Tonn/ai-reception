import "server-only";
import { cookies } from "next/headers";
import {
  CLAIMS_COOKIE_MAX_AGE_SECONDS,
  CLAIMS_COOKIE_NAME,
  addClaimToken,
  parseClaimCookie,
  serializeClaims,
} from "./claimCookie";

/** Reads the pending claim tokens of this browser. Never throws (cookies may be unavailable). */
export async function readPendingClaims(): Promise<string[]> {
  try {
    return parseClaimCookie((await cookies()).get(CLAIMS_COOKIE_NAME)?.value);
  } catch {
    return [];
  }
}

/** Replaces the cookie (or removes it when empty). Returns false when cookies are not writable. */
export async function writePendingClaims(tokens: string[]): Promise<boolean> {
  try {
    const store = await cookies();
    if (tokens.length === 0) {
      store.delete(CLAIMS_COOKIE_NAME);
      return true;
    }
    store.set(CLAIMS_COOKIE_NAME, serializeClaims(tokens), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: CLAIMS_COOKIE_MAX_AGE_SECONDS,
    });
    return true;
  } catch {
    return false;
  }
}

export async function appendPendingClaim(token: string): Promise<boolean> {
  return writePendingClaims(addClaimToken(await readPendingClaims(), token));
}
