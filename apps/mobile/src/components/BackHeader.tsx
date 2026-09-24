import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

/** Contextual back — same rule as the web app: only on secondary/flow
 * screens, never on a would-be top-level tab. `canGoBack()` falls back
 * to `/` so a deep link that opens this screen first (no history) still
 * has a safe destination instead of a dead button. */
export function BackHeader({ label }: { label: string }) {
  const router = useRouter();
  const { colors } = useTheme();

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }

  return (
    <Pressable onPress={handleBack} style={styles.row} hitSlop={8} accessibilityLabel={label}>
      <Text style={[styles.arrow, { color: colors.muted }]}>←</Text>
      <Text style={[styles.label, { color: colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, marginBottom: 8, minHeight: 44 },
  arrow: { fontSize: 16 },
  label: { fontSize: 14, fontWeight: "500" },
});
