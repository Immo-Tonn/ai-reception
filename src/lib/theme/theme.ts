/**
 * Theme preference — Light / Dark / System (per explicit product request).
 * Plain TypeScript, no Next.js import, so it is reusable from the future
 * React Native app the same way lib/i18n is.
 */
export const THEME_COOKIE = "serviceos_theme";

export const themes = ["light", "dark", "system"] as const;

export type Theme = (typeof themes)[number];

export const defaultTheme: Theme = "system";

export function isTheme(value: string | undefined | null): value is Theme {
  return !!value && (themes as readonly string[]).includes(value);
}

export function resolveTheme(value: string | undefined | null): Theme {
  return isTheme(value) ? value : defaultTheme;
}
