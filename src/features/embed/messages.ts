/**
 * postMessage protocol between the booking iframe (`/book/[slug]/embed`)
 * and the page that embeds it (embed.js modal, /embed-demo, or a
 * customer's own iframe). Pure validation helpers — no DOM access — so the
 * security rules are unit-testable. `public/embed.js` is plain JS and
 * cannot import this file; it mirrors these rules and a test pins the
 * shared constants.
 *
 * Trust model:
 *  - iframe → parent (resize): the parent accepts a message only if
 *    `event.origin` is the booking app's origin AND `event.source` is that
 *    very iframe's window. Anything else (another iframe, another window,
 *    another origin) is ignored.
 *  - parent → iframe (hello): lets the iframe learn the embedding page's
 *    real origin (taken from the browser-supplied `event.origin`, never from
 *    message content) so it can reply to that origin instead of "*". The
 *    iframe accepts a hello only from `window.parent`.
 *  - Payloads are data only (a height number); nothing is ever evaluated.
 */

export const EMBED_RESIZE_MESSAGE = "serviceos-booking-resize";
export const EMBED_HELLO_MESSAGE = "serviceos-booking-parent-hello";

export const MIN_EMBED_HEIGHT = 200;
export const MAX_EMBED_HEIGHT = 4000;

interface MessageLike {
  origin: string;
  source: unknown;
  data: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns a valid http(s) origin string, or `null`. Opaque origins ("null") are rejected. */
export function toHttpOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Parent-side: validates a resize message from the booking iframe.
 * Returns the clamped height, or `null` if the message must be ignored.
 */
export function parseResizeMessage(
  event: MessageLike,
  expected: { origin: string; source: unknown },
): number | null {
  if (event.origin !== expected.origin) return null;
  if (!expected.source || event.source !== expected.source) return null;
  if (!isRecord(event.data) || event.data.type !== EMBED_RESIZE_MESSAGE) return null;
  const height = event.data.height;
  if (typeof height !== "number" || !Number.isFinite(height)) return null;
  return Math.min(MAX_EMBED_HEIGHT, Math.max(MIN_EMBED_HEIGHT, Math.ceil(height)));
}

/**
 * Iframe-side: best-effort guess of the embedding page's origin before any
 * handshake — `location.ancestorOrigins[0]` (Chromium/Safari) or the
 * referrer's origin. `null` means "unknown — wait for the hello message";
 * never fall back to "*".
 */
export function resolveParentOrigin(input: {
  ancestorOrigins?: ArrayLike<string> | null;
  referrer?: string | null;
}): string | null {
  const ancestor = input.ancestorOrigins && input.ancestorOrigins.length > 0 ? input.ancestorOrigins[0] : null;
  return toHttpOrigin(ancestor) ?? toHttpOrigin(input.referrer);
}

/**
 * Iframe-side: validates a hello from the embedding page. Returns the
 * parent's origin (from the browser-supplied `event.origin`) or `null`.
 */
export function parseHelloMessage(event: MessageLike, parentWindow: unknown): string | null {
  if (!parentWindow || event.source !== parentWindow) return null;
  if (!isRecord(event.data) || event.data.type !== EMBED_HELLO_MESSAGE) return null;
  return toHttpOrigin(event.origin);
}
