/**
 * ServiceOS service worker — installability + app-like experience only
 * (§4). Deliberately NOT offline-first: it never caches page HTML
 * (which is where appointments/clients/finance/session data live), only
 * immutable static build assets and the public icon/offline files.
 *
 * Safe to cache (no user data, ever):
 *   /_next/static/*  — hashed JS/CSS bundles
 *   /icons/*, /manifest.webmanifest, /favicon.ico
 *   /offline.html    — static fallback shown only when navigation fails
 *
 * Never cached: any navigation (HTML page) request, any Server Action
 * call, any fetch to workspace/appointment/client/finance data.
 */

const VERSION = "serviceos-sw-v1";
const STATIC_CACHE = `${VERSION}-static`;

const PRECACHE_URLS = [
  "/offline.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  // Take over immediately on next load instead of waiting for all tabs
  // to close — "корректное обновление приложения" (§4).
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith("serviceos-sw-") && key !== STATIC_CACHE).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isSafeStaticAsset(url) {
  return (
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname === "/manifest.webmanifest" ||
      url.pathname === "/favicon.ico")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // never touch writes (Server Actions, forms)

  const url = new URL(request.url);

  // Navigations (HTML pages): network-only. Falling back to a cached
  // page here would risk showing stale — or someone else's — business
  // data. Only the generic offline notice is ever a fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
    );
    return;
  }

  // Hashed static assets: cache-first, since a given hashed URL's
  // content never changes.
  if (isSafeStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else (API-shaped fetches, data) — do not intercept.
});
