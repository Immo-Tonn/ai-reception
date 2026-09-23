import { LanguageSwitcher, ThemeSwitcher } from "@/components/ui";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getRequestTheme } from "@/lib/theme/next";
import styles from "./Preferences.module.css";

/**
 * Theme + language switchers, together, wherever the product needs them
 * visible (Landing, app shell — §Theme/Language requirement). Reads both
 * cookies once server-side so every placement stays in sync with no flash.
 */
export async function Preferences() {
  const [locale, theme] = await Promise.all([getRequestLocale(), getRequestTheme()]);
  const { settings } = getMessages(locale);

  return (
    <div className={styles.row}>
      <LanguageSwitcher currentLocale={locale} />
      <ThemeSwitcher initialTheme={theme} labels={settings.theme} />
    </div>
  );
}
