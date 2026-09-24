import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { Screen } from "../src/components/Screen";
import { ActionRow } from "../src/components/ActionRow";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n/I18nProvider";

/** Welcome / Entry — native mirror of the web root's neutral first
 * screen: same two doors in (Business / Client), no role selector. */
export default function WelcomeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();

  return (
    <Screen>
      <Text style={[styles.eyebrow, { color: colors.muted }]}>SERVICEOS</Text>
      <Text style={[styles.title, { color: colors.ink }]}>{t.welcomeTitle}</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>{t.welcomeSubtitle}</Text>

      <ActionRow label={t.manageBusiness} onPress={() => router.push("/business")} />
      <ActionRow label={t.bookService} onPress={() => router.push("/client")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  eyebrow: { fontSize: 12, fontWeight: "600", letterSpacing: 1, marginBottom: 12 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 12, lineHeight: 34 },
  subtitle: { fontSize: 15, lineHeight: 21, marginBottom: 24 },
});
