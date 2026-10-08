/**
 * Minimal central error reporter. Today it only logs; it exists so call
 * sites report through ONE function and a real reporting/retry backend
 * (and a notification retry queue) can be plugged in later without
 * touching them. Never throws.
 */
export function reportError(context: string, error: unknown): void {
  try {
    // eslint-disable-next-line no-console
    console.error(`[error] ${context}`, error);
  } catch {
    // reporting must never break the caller
  }
}
