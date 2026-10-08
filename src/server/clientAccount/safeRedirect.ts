const DEFAULT_TARGET = "/client";

/**
 * Open-redirect guard: only an internal path that is `/client` or under it is
 * accepted (plain path characters only; no scheme, no `//`, no backslash, no
 * `..`, no percent-encoding tricks). Everything else becomes `/client`.
 */
export function safeClientRedirect(value: unknown): string {
  if (typeof value !== "string" || value.length > 200) return DEFAULT_TARGET;
  if (!/^\/client(\/[A-Za-z0-9\-._~/]*)?(\?[A-Za-z0-9\-._~=&/]*)?$/.test(value)) return DEFAULT_TARGET;
  if (value.includes("//") || value.includes("..")) return DEFAULT_TARGET;
  return value;
}
