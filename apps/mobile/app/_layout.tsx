import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { I18nProvider } from "../src/i18n/I18nProvider";

function ThemedStack() {
  const { mode, colors } = useTheme();
  return (
    <>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.paper },
        }}
      />
    </>
  );
}

/**
 * Navigation shell foundation — Expo Router's file-based Stack, wrapped
 * in the theme + locale providers so every screen underneath can read
 * `useTheme()`/`useI18n()`. Deep links (`serviceos://...`, configured in
 * `app.config.ts`'s `scheme`) resolve into this same file-based route
 * tree automatically — no separate linking config needed for the
 * foundation routes below.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <ThemedStack />
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
