import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

/**
 * Google OpenID Connect ID token verification (RS256), done locally:
 *   1. signature with Google's published keys (JWKS from the discovery document),
 *   2. `iss` = https://accounts.google.com (or accounts.google.com),
 *   3. `aud` = our client id (and `azp` = our client id when present),
 *   4. `exp` in the future, `iat` not in the future (60 s clock skew),
 *   5. `nonce` = the single-use value we sealed into the OAuth flow cookie.
 * Only `sub` (the stable Google account id) is returned. E-mail is never read.
 * https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken
 */
export const GOOGLE_DISCOVERY_URL = "https://accounts.google.com/.well-known/openid-configuration";
const ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);
const SKEW_SECONDS = 60;

export class IdTokenError extends Error {
  constructor(public reason: string) {
    super(`ID token rejected: ${reason}`);
    this.name = "IdTokenError";
  }
}

export interface Jwk extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

/** Returns the current Google signing keys (cached by the caller). */
export type JwksSource = () => Promise<Jwk[]>;

const b64urlJson = (part: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  } catch {
    throw new IdTokenError("malformed");
  }
};

export async function verifyGoogleIdToken(
  token: unknown,
  opts: { clientId: string; nonce: string; now: Date; jwks: JwksSource },
): Promise<{ subject: string }> {
  if (typeof token !== "string" || token.length > 8192) throw new IdTokenError("missing");
  const parts = token.split(".");
  if (parts.length !== 3) throw new IdTokenError("malformed");
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);

  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new IdTokenError("alg");
  const key = (await opts.jwks()).find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!key) throw new IdTokenError("unknown_key");
  const ok = verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    createPublicKey({ key, format: "jwk" }),
    Buffer.from(parts[2], "base64url"),
  );
  if (!ok) throw new IdTokenError("signature");

  if (typeof claims.iss !== "string" || !ISSUERS.has(claims.iss)) throw new IdTokenError("iss");
  const aud = claims.aud;
  if (!(aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId)))) throw new IdTokenError("aud");
  if (claims.azp !== undefined && claims.azp !== opts.clientId) throw new IdTokenError("azp");
  const nowSec = Math.floor(opts.now.getTime() / 1000);
  if (typeof claims.exp !== "number" || claims.exp + SKEW_SECONDS < nowSec) throw new IdTokenError("exp");
  if (typeof claims.iat === "number" && claims.iat - SKEW_SECONDS > nowSec) throw new IdTokenError("iat");
  if (typeof claims.nonce !== "string" || claims.nonce.length === 0 || claims.nonce !== opts.nonce) throw new IdTokenError("nonce");
  if (typeof claims.sub !== "string" || !/^[0-9A-Za-z_-]{1,255}$/.test(claims.sub)) throw new IdTokenError("sub");
  return { subject: claims.sub };
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Google JWKS via the discovery document, cached in memory for the
 * `Cache-Control: max-age` Google sends (capped at 6 h, at least 5 min).
 * An unknown `kid` triggers one forced refresh (key rotation).
 */
export function createGoogleJwksSource(fetchImpl: FetchLike = (u, i) => fetch(u, i), timeoutMs = 6000): JwksSource & { forceNext(): void } {
  let cache: { keys: Jwk[]; until: number } | null = null;
  let force = false;
  const maxAge = (res: Response) => {
    const m = /max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "");
    return Math.min(Math.max(Number(m?.[1] ?? 300), 300), 6 * 3600) * 1000;
  };
  const source = (async () => {
    if (cache && !force && cache.until > Date.now()) return cache.keys;
    force = false;
    const signal = () => AbortSignal.timeout(timeoutMs);
    const disc = await fetchImpl(GOOGLE_DISCOVERY_URL, { signal: signal() });
    if (!disc.ok) throw new IdTokenError("jwks_unavailable");
    const jwksUri = ((await disc.json()) as { jwks_uri?: unknown }).jwks_uri;
    if (typeof jwksUri !== "string" || !jwksUri.startsWith("https://www.googleapis.com/")) throw new IdTokenError("jwks_unavailable");
    const res = await fetchImpl(jwksUri, { signal: signal() });
    if (!res.ok) throw new IdTokenError("jwks_unavailable");
    const keys = ((await res.json()) as { keys?: unknown }).keys;
    if (!Array.isArray(keys)) throw new IdTokenError("jwks_unavailable");
    cache = { keys: keys as Jwk[], until: Date.now() + maxAge(res) };
    return cache.keys;
  }) as JwksSource & { forceNext(): void };
  source.forceNext = () => {
    force = true;
  };
  return source;
}
