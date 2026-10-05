/**
 * THE single source of the app's public address. Every shareable thing in
 * Online booking (public link, website link, QR, embed script src, embed
 * iframe URL) is built from this one value via `buildBookingDistribution` —
 * nothing else may compose a public URL.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_APP_URL — explicit, wins everywhere. Set it in Vercel
 *      (Project → Settings → Environment Variables) to your real domain.
 *      Origin only; a path/trailing slash is stripped. No default value.
 *      EXCEPTION: on a Vercel PREVIEW deployment (VERCEL_ENV=preview) the
 *      deployment's own VERCEL_URL is tried before the production domain, so
 *      a preview never hands out production links.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — set automatically by Vercel: the
 *      project's production domain.
 *   3. VERCEL_URL — set automatically by Vercel: this deployment's URL.
 *      (Vercel provides the host without protocol; https is added.)
 *   4. Local only: the request's own localhost origin (`next dev` or a local
 *      `next start`), else http://localhost:3000 in development. A
 *      non-local request host is never used.
 *   5. Otherwise `baseUrl: null` — the UI says "not configured" rather
 *      than inventing an address.
 * No URL is hard-coded in source.
 */

export type PublicBaseUrlSource =
  | "env"
  | "vercel-production"
  | "vercel-deployment"
  | "dev-fallback"
  | "missing";

export interface PublicBaseUrl {
  baseUrl: string | null;
  source: PublicBaseUrlSource;
}

export interface PublicBaseUrlEnv {
  NEXT_PUBLIC_APP_URL?: string;
  VERCEL_PROJECT_PRODUCTION_URL?: string;
  VERCEL_URL?: string;
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}

/** Valid http(s) origin without trailing slash/path, or `null`. */
export function normalizeBaseUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** `localhost`, `127.0.0.1` or `[::1]`, optionally with a port. */
function isLocalHost(host: string | null | undefined): boolean {
  return Boolean(host && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host));
}

export function resolvePublicBaseUrl(env: PublicBaseUrlEnv, devHost?: string | null): PublicBaseUrl {
  const configured = normalizeBaseUrl(env.NEXT_PUBLIC_APP_URL);
  if (configured) return { baseUrl: configured, source: "env" };

  const deployment = normalizeBaseUrl(env.VERCEL_URL);
  if (env.VERCEL_ENV === "preview" && deployment) return { baseUrl: deployment, source: "vercel-deployment" };

  const vercel = normalizeBaseUrl(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercel) return { baseUrl: vercel, source: "vercel-production" };

  if (deployment) return { baseUrl: deployment, source: "vercel-deployment" };

  if (env.NODE_ENV === "development" || isLocalHost(devHost)) {
    const dev = normalizeBaseUrl(devHost ? `http://${devHost}` : "http://localhost:3000");
    return { baseUrl: dev, source: "dev-fallback" };
  }

  return { baseUrl: null, source: "missing" };
}

/** Server-side convenience wrapper over `process.env`. */
export function getPublicBaseUrl(devHost?: string | null): PublicBaseUrl {
  return resolvePublicBaseUrl(
    {
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
      VERCEL_URL: process.env.VERCEL_URL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
    },
    devHost,
  );
}
