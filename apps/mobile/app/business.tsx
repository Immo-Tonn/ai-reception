import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { Screen } from "../src/components/Screen";
import { BackHeader } from "../src/components/BackHeader";
import { ActionRow } from "../src/components/ActionRow";
import { useTheme } from "../src/theme/ThemeProvider";
import { useI18n } from "../src/i18n/I18nProvider";

/** Business placeholder — foundation only, not the real Business shell
 * (Today/Calendar/Clients/…). Proves the route + back navigation work. */
export default function BusinessScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();

  return (
    <Screen>
      <BackHeader label={t.back} />
      <Text style={[styles.title, { color: colors.ink }]}>{t.businessTitle}</Text>
      <Text style={[styles.body, { color: colors.muted }]}>{t.businessBody}</Text>
      <ActionRow label={t.signInTitle} onPress={() => router.push("/login")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 24, fontWeight: "700", marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
});
