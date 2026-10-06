import Link from "next/link";
import { Icon, LanguageSwitcher, ThemeSwitcher } from "@/components/ui";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getRequestTheme } from "@/lib/theme/next";
import { BookingLinkRow } from "./BookingLinkRow";
import styles from "./page.module.css";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const [locale, theme] = await Promise.all([getRequestLocale(), getRequestTheme()]);
  const { nav, settings } = getMessages(locale);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{nav.settings}</h1>

      <Link href={`/${workspaceSlug}/settings/staff`} className={styles.row}>
        <div className={styles.rowBody}>
          <p className={styles.rowLabel}>{settings.staff.label}</p>
          <p className={styles.rowDescription}>{settings.staff.description}</p>
        </div>
        <Icon name="chevronRight" size={18} />
      </Link>

      <Link href={`/${workspaceSlug}/settings/services`} className={styles.row}>
        <div className={styles.rowBody}>
          <p className={styles.rowLabel}>{settings.services.label}</p>
          <p className={styles.rowDescription}>{settings.services.description}</p>
        </div>
        <Icon name="chevronRight" size={18} />
      </Link>

      <Link href={`/${workspaceSlug}/settings/hours`} className={styles.row}>
        <div className={styles.rowBody}>
          <p className={styles.rowLabel}>{settings.hours.label}</p>
          <p className={styles.rowDescription}>{settings.hours.description}</p>
        </div>
        <Icon name="chevronRight" size={18} />
      </Link>

      <BookingLinkRow
        slug={workspaceSlug}
        label={settings.bookingLink.label}
        description={settings.bookingLink.description}
        copyLabel={settings.bookingLink.copy}
        copiedLabel={settings.bookingLink.copied}
      />

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

      <Link href={`/${workspaceSlug}/settings/account`} className={styles.row}>
        <div className={styles.rowBody}>
          <p className={styles.rowLabel}>{settings.account.label}</p>
          <p className={styles.rowDescription}>{settings.account.description}</p>
        </div>
        <Icon name="chevronRight" size={18} />
      </Link>
    </main>
  );
}
