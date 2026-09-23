import { LanguageSwitcher, ThemeSwitcher } from "@/components/ui";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getRequestTheme } from "@/lib/theme/next";
import styles from "./page.module.css";

export default async function SettingsPage() {
  const [locale, theme] = await Promise.all([getRequestLocale(), getRequestTheme()]);
  const { nav, settings } = getMessages(locale);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{nav.settings}</h1>

      <div className={styles.row}>
        <div className={styles.rowBody}>
          <p className={styles.rowLabel}>{settings.language.label}</p>
          <p className={styles.rowDescription}>{settings.language.description}</p>
        </div>
        <LanguageSwitcher currentLocale={locale} />
      </div>

      <div className={styles.row}>
        <div className={styles.rowBody}>
          <p className={styles.rowLabel}>{settings.theme.label}</p>
        </div>
        <ThemeSwitcher initialTheme={theme} labels={settings.theme} />
      </div>
    </main>
  );
}
