/**
 * "Password reset in progress" flag (strict mode).
 *
 * After a person enters the e-mailed recovery code they hold a real session
 * but have NO known password. Until they set one, the rest of the app stays
 * closed: `src/proxy.ts` sends every other page to /reset-password/new. The
 * cookie value is the moment the window closes (epoch ms); after that the
 * new password is refused and the person must start over.
 *
 * This is a convenience lock for the OWNER, not an access-control boundary:
 * authorization stays in `getSession()` and Row Level Security.
 */
export const RECOVERY_FLAG_COOKIE = "serviceos_pw_reset";
/** How long a person has to set the new password after entering the code. */
export const RECOVERY_WINDOW_MS = 15 * 60 * 1000;
/** The cookie outlives the window so an expired window is still noticed (and closed) on the next visit. */
export const RECOVERY_COOKIE_MAX_AGE_S = 24 * 60 * 60;

export function newRecoveryFlagValue(now: number = Date.now()): string {
  return String(now + RECOVERY_WINDOW_MS);
}

/** A missing or unreadable value counts as expired. */
export function isRecoveryFlagExpired(value: string | undefined, now: number = Date.now()): boolean {
  const until = Number(value);
  return !Number.isFinite(until) || until < now;
}

const ALLOWED_PATHS = [/^\/reset-password(\/.*)?$/, /^\/forgot-password$/, /^\/login$/];

/** Pages (and static files) that stay reachable while the flag is set. */
export function isRecoveryAllowedPath(pathname: string): boolean {
  if (/\.[A-Za-z0-9]+$/.test(pathname)) return true; // static files: logo, service worker, ...
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return ALLOWED_PATHS.some((re) => re.test(normalized));
}
