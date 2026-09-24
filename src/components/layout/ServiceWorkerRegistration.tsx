"use client";

import { useEffect } from "react";

/**
 * Registers the service worker and reloads once when a new version
 * activates — "корректное обновление приложения" (§4). No UI, no
 * offline-first caching decisions here; those live in public/sw.js.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    // Dev-mode Turbopack chunk URLs aren't reliably content-hashed the
    // way a production build's are — a cache-first SW (see sw.js) can
    // pin a stale /_next/static/* chunk in the browser's Cache Storage
    // across server restarts, hydrating fresh SSR HTML against old
    // client JS. Only register in production, where the hashing
    // guarantee the SW relies on actually holds.
    if (process.env.NODE_ENV !== "production") {
      // One-time self-heal for a browser that already installed the SW
      // during an earlier dev session (before this guard existed) — it
      // would otherwise keep serving its stale cached chunks forever,
      // since Cache Storage outlives server restarts.
      navigator.serviceWorker.getRegistrations().then((regs) => {
        regs.forEach((reg) => reg.unregister());
      });
      if ("caches" in window) {
        caches.keys().then((keys) => {
          keys.filter((key) => key.startsWith("serviceos-sw-")).forEach((key) => caches.delete(key));
        });
      }
      return;
    }

    let refreshed = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Installability still works without the SW registered (browsers
      // vary); failing silently here is intentional — this is a
      // progressive enhancement, not a requirement to use the app.
    });
  }, []);

  return null;
}
