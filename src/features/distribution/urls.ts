/**
 * Everything the owner can hand out to get bookings. All of it points at
 * the ONE existing booking flow (`/book/[workspaceSlug]`). `baseUrl` must
 * come from `getPublicBaseUrl()` (lib/config/publicBaseUrl.ts) — this
 * builder is the only place public URLs are composed. The website-button
 * link carries a `source` query param (ignored by the flow, for future
 * channel analytics); the public link and the QR have none.
 */

export interface BookingDistribution {
  /** Plain public booking page. */
  bookingUrl: string;
  /** Same page, for a "Book appointment" button on the owner's website. */
  websiteLinkUrl: string;
  /** Encoded in the QR code — EXACTLY `bookingUrl`, the same string shown in the Public booking link field. */
  qrUrl: string;
  /** Chromeless page used by the iframe/modal embed. */
  embedPageUrl: string;
  /** Paste-once script that adds a button + modal booking window. */
  scriptSnippet: string;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildBookingDistribution(baseUrl: string, workspaceSlug: string): BookingDistribution {
  const base = baseUrl.replace(/\/+$/, "");
  const path = `/book/${encodeURIComponent(workspaceSlug)}`;
  const bookingUrl = `${base}${path}`;

  return {
    bookingUrl,
    websiteLinkUrl: `${bookingUrl}?source=website`,
    qrUrl: bookingUrl,
    embedPageUrl: `${bookingUrl}/embed`,
    scriptSnippet: `<script src="${escapeAttribute(`${base}/embed.js`)}"\n        data-workspace="${escapeAttribute(workspaceSlug)}"\n        data-origin="${escapeAttribute(base)}"\n        async></script>`,
  };
}
