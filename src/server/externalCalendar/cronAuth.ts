import { safeEqual } from "./crypto";

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the project has
 * a CRON_SECRET environment variable. No secret configured = the endpoint is
 * closed (never open by default). Timing-safe comparison.
 */
export function isAuthorizedCronRequest(authorization: string | null, secret: string | undefined): boolean {
  const expected = secret?.trim();
  if (!expected || expected.length < 16 || !authorization) return false;
  return safeEqual(authorization, `Bearer ${expected}`);
}
