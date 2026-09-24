import { StyleSheet, Text } from "react-native";
import { Screen } from "../src/components/Screen";
import { BackHeader } from "../src/components/BackHeader";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n/I18nProvider";

/** Client placeholder — foundation only, not the real booking flow. */
export default function ClientScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();

  return (
    <Screen>
      <BackHeader label={t.back} />
      <Text style={[styles.title, { color: colors.ink }]}>{t.clientTitle}</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{t.clientBody}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20 },
});
