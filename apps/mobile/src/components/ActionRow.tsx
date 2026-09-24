import { Pressable, StyleSheet, Text } from "react-native";
import { useTheme } from "../theme/ThemeProvider";

/** Mirrors the web root's compact action row (label + arrow), native
 * equivalent kept just as small — this is shared foundation, not a
 * pixel-perfect port of the web CSS. */
export function ActionRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: colors.border, backgroundColor: pressed ? colors.paper : colors.surface },
      ]}
    >
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <Text style={[styles.arrow, { color: colors.muted }]}>→</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  label: { fontSize: 15, fontWeight: "500" },
  arrow: { fontSize: 16 },
});
