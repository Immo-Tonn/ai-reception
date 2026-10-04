export const DEFAULT_CLIENT_REDIRECT = "/client/bookings";

/**
 * `?redirect=` is passed through to the sign-in / sign-up forms only when it is an internal
 * `/client...` path. Anything that could leave the origin or climb out of /client (scheme,
 * `//`, backslash, dot segments, encoded slashes/dots, control characters) falls back to the
 * default. The server re-validates; this is the first line, not the only one.
 */
export function sanitizeClientRedirect(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return DEFAULT_CLIENT_REDIRECT;
  const v = value.trim();
  if (v.length === 0 || v.length > 200) return DEFAULT_CLIENT_REDIRECT;
  if (!(v === "/client" || v.startsWith("/client/") || v.startsWith("/client?"))) return DEFAULT_CLIENT_REDIRECT;
  if (v.includes("//") || v.includes("\\") || /[\u0000-\u001f\u007f]/.test(v)) return DEFAULT_CLIENT_REDIRECT;
  if (/%(2e|2f|5c|00)/i.test(v)) return DEFAULT_CLIENT_REDIRECT;
  const path = v.split(/[?#]/)[0];
  if (path.split("/").some((segment) => segment === ".." || segment === ".")) return DEFAULT_CLIENT_REDIRECT;
  return v;
}

/** Link to a client auth page carrying the (fixed, non-sensitive) return path. */
export function clientAuthHref(page: "login" | "signup", redirect: string = DEFAULT_CLIENT_REDIRECT): string {
  return `/client/${page}?redirect=${encodeURIComponent(sanitizeClientRedirect(redirect))}`;
}
