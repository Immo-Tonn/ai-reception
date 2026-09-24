import Constants from "expo-constants";

/**
 * Environment/config abstraction (§ item 9 of the native foundation
 * task) — the rest of the app reads config through this module, never
 * `Constants.expoConfig` directly, so swapping the source (build-time
 * env vars, a remote config service, whatever) later touches one file.
 * No real values yet — `apiBaseUrl` is empty until a backend exists.
 */
interface AppConfig {
  apiBaseUrl: string;
}

export const appConfig: AppConfig = {
  apiBaseUrl: (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "",
};
