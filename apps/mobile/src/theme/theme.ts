/**
 * Theme foundation — Light/Dark/System, same conceptual palette as the
 * web app's design tokens (`src/lib design-tokens` on the web side is
 * CSS custom properties; this is the RN equivalent as plain objects,
 * since RN has no CSS variables). Kept intentionally small: this is a
 * foundation for a native shell, not a full design system port.
 */
export interface ThemeColors {
  paper: string;
  surface: string;
  ink: string;
  muted: string;
  border: string;
  accentBlue: string;
}

export const lightColors: ThemeColors = {
  paper: "#FAF9F7",
  surface: "#FFFFFF",
  ink: "#111111",
  muted: "#6B6B6B",
  border: "#E5E3DF",
  accentBlue: "#3A66E0",
};

export const darkColors: ThemeColors = {
  paper: "#12141C",
  surface: "#1B1E29",
  ink: "#F5F5F5",
  muted: "#9A9AA2",
  border: "#2A2D3A",
  accentBlue: "#7EA6FF",
};

export type ThemeMode = "light" | "dark";
