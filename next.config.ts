import type { NextConfig } from "next";

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
  async headers() {
    return [
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
