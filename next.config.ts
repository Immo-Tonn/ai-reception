import type { NextConfig } from "next";
import { isStagingEnv, parseAllowedDevOrigins } from "./src/lib/config/appEnv";

/**
 * Framing policy.
 *
 * - Every ordinary ServiceOS page may only be framed by ServiceOS itself
 *   (`frame-ancestors 'self'`, plus legacy X-Frame-Options) — a third-party
 *   site can't iframe the business app, login, or client pages
 *   (clickjacking).
 * - The booking embed (`/book/<slug>/embed`) exists to be iframed on other
 *   sites, so it gets `frame-ancestors *` and NO X-Frame-Options (that
 *   header can't express "any site" and would block the embed). It is a
 *   public, unauthenticated booking form, so any-site framing is the
 *   intended exposure; a per-workspace allowed-origins list is a future,
 *   backend-backed setting.
 *
 * The first rule's negative lookahead excludes the embed route, so the two
 * rules never both apply to one URL (Next merges duplicate header keys
 * unpredictably).
 */
const nextConfig: NextConfig = {
  // DEV ONLY (ignored by `next build`/production): lets a phone on the same Wi-Fi load the
  // dev server by LAN address. Set ALLOWED_DEV_ORIGINS="192.168.x.y,other-host" in .env.local
  // (comma list, empty by default). Never hard-code a LAN IP here.
  allowedDevOrigins: parseAllowedDevOrigins(process.env.ALLOWED_DEV_ORIGINS),
  async headers() {
    return [
      // STAGING only (NEXT_PUBLIC_APP_ENV=staging): never index the test site.
      ...(isStagingEnv()
        ? [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }]
        : []),
      {
        source: "/:path((?!book/[^/]+/embed$).*)",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        source: "/book/:workspaceSlug/embed",
        headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }],
      },
    ];
  },
};

export default nextConfig;
