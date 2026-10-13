import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server-only secrets for external calendars.
 *
 * - Refresh tokens are stored ENCRYPTED (AES-256-GCM). The additional
 *   authenticated data binds a ciphertext to its workspace + staff member, so
 *   a ciphertext copied onto another row does not decrypt.
 * - OAuth state, the PKCE verifier and the short calendar-setup session live in
 *   SEALED httpOnly cookies (same cipher, different derived key): the browser
 *   holds them but can neither read nor forge them.
 *
 * The master key comes from EXTERNAL_CALENDAR_ENCRYPTION_KEY (32 random bytes,
 * base64). It is never sent to the browser and never logged. Rotating it makes
 * existing connections undecryptable: they show as "reconnect needed".
 */

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super("EXTERNAL_CALENDAR_ENCRYPTION_KEY is missing or not 32 bytes (base64).");
    this.name = "EncryptionKeyMissingError";
  }
}

export class DecryptionError extends Error {
  constructor() {
    super("Ciphertext could not be decrypted.");
    this.name = "DecryptionError";
  }
}

const VERSION = "v1";
const b64url = (buf: Buffer) => buf.toString("base64url");

/** Decodes and checks the master key; `null` if absent or malformed. */
export function parseMasterKey(raw: string | undefined | null): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  return key.length === 32 ? key : null;
}

export interface SecretBox {
  encrypt(plaintext: string, context: string): string;
  decrypt(ciphertext: string, context: string): string;
}

function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), `serviceos:external-calendar:${purpose}`, 32));
}

export function createSecretBox(master: Buffer, purpose: "tokens" | "cookies"): SecretBox {
  const key = deriveKey(master, purpose);
  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(context, "utf8"));
      const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [VERSION, b64url(iv), b64url(cipher.getAuthTag()), b64url(body)].join(".");
    },
    decrypt(ciphertext, context) {
      const parts = typeof ciphertext === "string" ? ciphertext.split(".") : [];
      if (parts.length !== 4 || parts[0] !== VERSION) throw new DecryptionError();
      try {
        const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
        decipher.setAAD(Buffer.from(context, "utf8"));
        decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
        return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
      } catch {
        throw new DecryptionError();
      }
    },
  };
}

/** Context string for a stored refresh token (AAD). */
export const tokenContext = (workspaceId: string, staffId: string) => `refresh:${workspaceId}:${staffId}`;

/** Seals a JSON value with an expiry; `unseal` returns null when invalid, tampered or expired. */
export function seal(box: SecretBox, purpose: string, value: unknown, expiresAt: Date): string {
  return box.encrypt(JSON.stringify({ v: value, exp: expiresAt.getTime() }), `cookie:${purpose}`);
}

export function unseal<T>(box: SecretBox, purpose: string, sealed: string | undefined | null, now: Date): T | null {
  if (!sealed || sealed.length > 4096) return null;
  try {
    const parsed = JSON.parse(box.decrypt(sealed, `cookie:${purpose}`)) as { v: T; exp: number };
    if (typeof parsed?.exp !== "number" || parsed.exp < now.getTime()) return null;
    return parsed.v;
  } catch {
    return null;
  }
}

/** 32 random bytes as hex — connect-link tokens, OAuth state. */
export const randomToken = () => randomBytes(32).toString("hex");

export const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** PKCE (RFC 7636, S256). */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const TOKEN_RE = /^[0-9a-f]{64}$/;
