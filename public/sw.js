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

// Bumped so `activate` purges any cache namespace from before this file
// existed — including one holding a stale dev-mode JS chunk that caused
// a hydration mismatch (cache-first served pre-edit code against fresh
// SSR HTML). Bump again if this ever needs to force another cache-out.
const VERSION = "serviceos-sw-v2";
const STATIC_CACHE = `${VERSION}-static`;

const PRECACHE_URLS = [
  "/offline.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Turbopack/webpack dev-mode chunk URLs aren't reliably content-hashed
// the way a production build's are, so cache-first for `/_next/static/`
// is only safe in production. A browser always byte-checks THIS file
// itself on every `register()` call, bypassing any SW's own fetch
// interception — so shipping this check here self-heals a browser that
// already installed an earlier, unconditionally-caching version of this
// worker, without depending on any other (possibly stale-cached) app
// JS to run first.
function isDevHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

const DEV_HOST = isDevHost(self.location.hostname);

self.addEventListener("install", (event) => {
  if (DEV_HOST) {
    self.skipWaiting();
    return;
  }
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
      .then(() => self.clients.claim())
      .then(() => {
        // On a dev host, this worker has nothing left to do — hand
        // control back so every subsequent request goes straight to
        // the network, then remove the registration entirely.
        if (DEV_HOST) return self.registration.unregister();
      }),
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
  if (DEV_HOST) return; // network-only, unconditionally, while this un-registers

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
