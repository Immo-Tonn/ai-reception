/**
 * Small browser-side helpers for EVENT HANDLERS (never called during render).
 * Kept outside components so React's purity rules see plain function calls.
 */

/** Local, not-persisted id for optimistic/demo items: "<ms>" or "<ms>-<suffix>". */
export function newLocalId(suffix?: string): string {
  const now = Date.now();
  return suffix ? `${now}-${suffix}` : `${now}`;
}

/** Writes a first-party preference cookie (theme, locale) for one year. */
export function writePreferenceCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; SameSite=Lax`;
}
