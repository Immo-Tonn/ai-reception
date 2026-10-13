import "server-only";
import { getRateLimiter } from "@/server/ratelimit";
import { ExternalCalendarError, type ExternalCalendarErrorKind } from "./service";

/**
 * Shared HTTP details of the public connect flow (no session: the connect link
 * and the sealed cookies are the only credentials).
 */
export const cookieOptions = (maxAgeSeconds: number, path: string) => ({
  httpOnly: true,
  sameSite: "lax" as const, // the OAuth callback is a top-level GET from Google
  secure: process.env.NODE_ENV === "production",
  path,
  maxAge: maxAgeSeconds,
});

/** Public connect flow error codes shown on the pages (never raw text). */
export type ConnectPageError = ExternalCalendarErrorKind | "rate_limited" | "unknown";

export function toConnectError(error: unknown): ConnectPageError {
  if (error instanceof ExternalCalendarError) return error.code;
  console.error("[calendar connect] unexpected failure:", error instanceof Error ? error.name : "unknown");
  return "unknown";
}

/** Throws `rate_limited` when exceeded; fails closed if the limiter is unavailable. */
export async function limitConnectAttempts(scope: string, ip: string, limit: number): Promise<void> {
  let allowed = false;
  try {
    allowed = (await getRateLimiter().hit({ scope, limit, windowSeconds: 3600 }, ip)).allowed;
  } catch {
    allowed = false;
  }
  if (!allowed) throw new RateLimitedError();
}

export class RateLimitedError extends Error {
  constructor() {
    super("rate limited");
    this.name = "RateLimitedError";
  }
}

const KNOWN: ConnectPageError[] = [
  "forbidden", "not_found", "not_configured", "invalid_input", "invalid_link", "expired_link", "denied",
  "state_mismatch", "insufficient_scope", "provider_error", "rate_limited", "unknown",
];
export const parseConnectError = (raw: string | string[] | undefined): ConnectPageError | null =>
  typeof raw === "string" && (KNOWN as string[]).includes(raw) ? (raw as ConnectPageError) : null;
