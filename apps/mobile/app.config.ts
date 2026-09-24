import type { ExpoConfig, ConfigContext } from "expo/config";

/**
 * PROVISIONAL — bundle identifier and package name below are placeholders
 * until the company/domain identifier is finalized. Do not ship to the
 * App Store / Play Store with these values without updating them first
 * (§ HANDOFF_GRAPH.md — native mobile foundation, not a store-ready app).
 *
 * No signing certificates, keystores, or store credentials live here or
 * anywhere in this project — that's a deliberate boundary, not an
 * oversight.
 */
const PROVISIONAL_IOS_BUNDLE_ID = "com.serviceos.app"; // PROVISIONAL
const PROVISIONAL_ANDROID_PACKAGE = "com.serviceos.app"; // PROVISIONAL

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "ServiceOS",
  slug: "serviceos",
  scheme: "serviceos",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
    bundleIdentifier: PROVISIONAL_IOS_BUNDLE_ID,
  },
  android: {
    package: PROVISIONAL_ANDROID_PACKAGE,
    adaptiveIcon: {
      backgroundColor: "#FAF9F7",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    favicon: "./assets/favicon.png",
  },
  plugins: ["expo-router", "expo-status-bar", "expo-localization"],
  extra: {
    // Environment/config abstraction (§ item 9) — no real values yet,
    // just the names the app expects once a backend exists. Never put
    // secrets here; this block ends up in the built app bundle.
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  },
});
