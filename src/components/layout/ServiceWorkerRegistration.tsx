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
