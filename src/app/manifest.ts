import type { MetadataRoute } from "next";

/**
 * PWA manifest (§4). Served at /manifest.webmanifest by Next's metadata
 * API. `start_url` is the marketing landing, not a workspace — a real
 * signed-in redirect happens once Auth exists; installing the app today
 * just gets you to the same place a fresh browser tab would.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ServiceOS — business assistant for service businesses",
    short_name: "ServiceOS",
    description:
      "Scheduling, clients, jobs, finance and an AI assistant for service businesses.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f6f5f2",
    theme_color: "#111111",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
