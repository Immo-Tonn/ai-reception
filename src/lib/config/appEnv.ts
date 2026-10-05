/**
 * Deployment environment marker. Driven by ONE public variable,
 * `NEXT_PUBLIC_APP_ENV` = `local` | `staging` | `production` (default `local`;
 * anything unknown also falls back to `local`, never to a louder mode).
 *
 * - `staging`: a visible "test environment" badge is rendered and the site is
 *   marked `noindex, nofollow` (meta + X-Robots-Tag header).
 * - `local` / `production`: nothing extra.
 *
 * This is NOT an authorization mechanism and carries no secret.
 */
export type AppEnv = "local" | "staging" | "production";

export function resolveAppEnv(raw: string | undefined | null): AppEnv {
  const value = raw?.trim().toLowerCase();
  return value === "staging" || value === "production" ? value : "local";
}

/** Server-side convenience wrapper (explicit property access so Next can inline it). */
export function getAppEnv(): AppEnv {
  return resolveAppEnv(process.env.NEXT_PUBLIC_APP_ENV);
}

export function isStagingEnv(env: AppEnv = getAppEnv()): boolean {
  return env === "staging";
}

/** Comma list (`ALLOWED_DEV_ORIGINS`) -> trimmed, non-empty hosts. Dev server only. */
export function parseAllowedDevOrigins(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
