import { StyleSheet, Text } from "react-native";
import { Screen } from "../src/components/Screen";
import { BackHeader } from "../src/components/BackHeader";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n/I18nProvider";

/** Sign-in placeholder — no real auth wired up (§ do not connect
 * Supabase/Apple/Google sign-in in this foundation pass). */
export default function LoginScreen() {
  const { colors } = useTheme();
  const { t } = useI18n();

  return (
    <Screen>
      <BackHeader label={t.back} />
      <Text style={[styles.title, { color: colors.ink }]}>{t.signInTitle}</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{t.signInBody}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20 },
});
