/**
 * THE freshness policy for external busy time (docs/EXTERNAL_CALENDAR.md §Policy).
 *
 * - Browsing (slots, available dates): cached busy time younger than
 *   `browseTtlMs` is used as is; older triggers ONE refresh per connection
 *   (a DB claim prevents parallel refreshes, a back-off prevents hammering a
 *   failing provider).
 * - Committing (creating / moving an appointment): the cache must be younger
 *   than `commitTtlMs`, otherwise a refresh is attempted first.
 * - If the provider cannot answer, cached busy time is still trusted up to
 *   `maxStaleMs`. Beyond that the person is UNCONFIRMED: they get no slots and
 *   the business cannot book them, but every other staff member stays bookable.
 *   No answer from the provider is never read as "free".
 */
export const EXTERNAL_BUSY_POLICY = {
  browseTtlMs: 5 * 60_000,
  commitTtlMs: 60_000,
  maxStaleMs: 15 * 60_000,
  /** After a failed refresh, browsing does not call the provider again for this long. */
  backoffMs: 60_000,
  /** A refresh claim older than this is considered abandoned (crashed lambda). */
  claimMs: 30_000,
  /** Cached window: from `now - windowPastMs` ... */
  windowPastMs: 24 * 60 * 60_000,
  /** ... to `now + windowFutureDays` (max booking horizon 180 days + edges). */
  windowFutureDays: 183,
  /** One provider request never spans more than this (chunked). */
  maxRequestDays: 60,
  /** Calendars per connection whose busy time is counted. */
  maxCalendars: 10,
  /** Per HTTP call to the provider. */
  requestTimeoutMs: 6_000,
} as const;

export type ExternalBusyMode = "browse" | "commit";

export interface BusyCacheState {
  fetchedAt: Date | null;
  windowFrom: Date | null;
  windowUntil: Date | null;
}

export function cacheWindow(now: Date): { from: Date; until: Date } {
  return {
    from: new Date(now.getTime() - EXTERNAL_BUSY_POLICY.windowPastMs),
    until: new Date(now.getTime() + EXTERNAL_BUSY_POLICY.windowFutureDays * 24 * 60 * 60_000),
  };
}

export function cacheCovers(state: BusyCacheState, from: Date, until: Date): boolean {
  return Boolean(
    state.fetchedAt && state.windowFrom && state.windowUntil &&
      state.windowFrom.getTime() <= from.getTime() && state.windowUntil.getTime() >= until.getTime(),
  );
}

const ageMs = (state: BusyCacheState, now: Date) => (state.fetchedAt ? now.getTime() - state.fetchedAt.getTime() : Infinity);

/** Can the cache answer this request without asking the provider? */
export function isCacheFresh(state: BusyCacheState, now: Date, mode: ExternalBusyMode, from: Date, until: Date): boolean {
  const ttl = mode === "commit" ? EXTERNAL_BUSY_POLICY.commitTtlMs : EXTERNAL_BUSY_POLICY.browseTtlMs;
  return cacheCovers(state, from, until) && ageMs(state, now) <= ttl;
}

/** Fallback when no refresh happened or it failed: is the cache still trustworthy? */
export function isCacheUsableWhenStale(state: BusyCacheState, now: Date, from: Date, until: Date): boolean {
  return cacheCovers(state, from, until) && ageMs(state, now) <= EXTERNAL_BUSY_POLICY.maxStaleMs;
}

/** [from, until) split into chunks of at most `maxRequestDays`. */
export function requestChunks(from: Date, until: Date): { from: Date; until: Date }[] {
  const step = EXTERNAL_BUSY_POLICY.maxRequestDays * 24 * 60 * 60_000;
  const out: { from: Date; until: Date }[] = [];
  for (let t = from.getTime(); t < until.getTime(); t += step) {
    out.push({ from: new Date(t), until: new Date(Math.min(t + step, until.getTime())) });
  }
  return out;
}
