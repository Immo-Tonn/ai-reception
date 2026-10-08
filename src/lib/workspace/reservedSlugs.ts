/**
 * Slugs a business may NOT take. A workspace slug is a public URL
 * (`/<slug>/today`, `/book/<slug>`), so it must not collide with a static
 * route, an asset path, or a demo workspace.
 *
 * MIRRORS `public.is_slug_allowed()` in supabase/migrations/0008 — the
 * database is the final authority; this copy exists to give the signup
 * form an early, friendly answer. A unit test fails if the two lists drift.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "demo", "book", "client", "business", "login", "signup", "logout",
  "onboarding", "embed", "embed-demo", "embed-js", "api", "auth", "admin",
  "app", "settings", "static", "assets", "public", "icons", "manifest",
  "favicon", "sitemap", "robots", "www", "help", "support", "status",
  "dashboard", "new",
];

export const DEMO_SLUG_PREFIX = "demo-";
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 60;

export function isSlugAllowed(slug: string): boolean {
  return (
    SLUG_PATTERN.test(slug) &&
    slug.length >= SLUG_MIN_LENGTH &&
    slug.length <= SLUG_MAX_LENGTH &&
    !slug.startsWith(DEMO_SLUG_PREFIX) &&
    !RESERVED_SLUGS.includes(slug)
  );
}
