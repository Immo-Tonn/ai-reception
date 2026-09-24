import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { darkColors, lightColors, type ThemeColors, type ThemeMode } from "./theme";

type ThemePreference = ThemeMode | "system";

interface ThemeContextValue {
  colors: ThemeColors;
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Light/Dark/System foundation. "System" follows the OS color scheme via
 * `useColorScheme` (no persistence yet — a future pass can add
 * AsyncStorage once there's a real settings screen to drive it).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>("system");

  const mode: ThemeMode = preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
  const colors = mode === "dark" ? darkColors : lightColors;

  const value = useMemo(() => ({ colors, mode, preference, setPreference }), [colors, mode, preference]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
