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

/**
 * DEV SERVER ONLY. `next dev` (Next 16) answers 403 to /_next/* dev requests
 * (HMR websocket, internal endpoints) whose Origin is not localhost or listed
 * in `allowedDevOrigins`. A phone opening http://<LAN-IP>:3000 then receives
 * server-rendered HTML that NEVER hydrates: it scrolls, but no tap does
 * anything. These pure helpers let a server-rendered banner say so out loud.
 */
export function hostnameOf(hostHeader: string | undefined | null): string {
  const raw = (hostHeader ?? "").trim().toLowerCase();
  if (raw.startsWith("[")) return raw.slice(0, raw.indexOf("]") + 1); // [::1]:3000
  return raw.split(":")[0] ?? "";
}

function matchesPattern(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p.includes("*")) return host === p;
  const re = new RegExp(
    "^" +
      p
        .split("**")
        .map((part) => part.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^.]+"))
        .join(".*") +
      "$",
  );
  return re.test(host);
}

/** True when `next dev` would block dev resources for a page opened via this Host. */
export function isDevHostBlocked(hostHeader: string | undefined | null, allowed: string[]): boolean {
  const host = hostnameOf(hostHeader);
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  return !allowed.some((pattern) => matchesPattern(host, pattern));
}
