/**
 * Who is recovering a password: a business user (signs in at /login) or a
 * client (signs in at /client/login). It is the SAME account system, so the
 * code and the screens are shared; only the way back differs.
 *
 * The value travels in the URL (`for=client`) and in a hidden form field. It is
 * never used as a redirect target itself: it only picks one of two fixed paths.
 */
export type RecoveryAudience = "business" | "client";

/** Anything but the exact word "client" is the business audience. */
export function parseRecoveryAudience(value: unknown): RecoveryAudience {
  return value === "client" ? "client" : "business";
}

export function recoveryLoginPath(audience: RecoveryAudience): "/login" | "/client/login" {
  return audience === "client" ? "/client/login" : "/login";
}

/** `path` plus its query parameters; the client audience adds `for=client` (business URLs stay unchanged). */
export function withAudience(path: string, audience: RecoveryAudience, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params);
  if (audience === "client") query.set("for", "client");
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}
