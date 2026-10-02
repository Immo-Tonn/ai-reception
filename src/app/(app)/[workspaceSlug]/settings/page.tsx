import Link from "next/link";
import { Button, Icon, LanguageSwitcher, ThemeSwitcher } from "@/components/ui";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getRequestTheme } from "@/lib/theme/next";
import { headers } from "next/headers";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { signOutAction } from "@/server/actions/auth.actions";
import { getPublicBaseUrl } from "@/lib/config/publicBaseUrl";
import { buildBookingDistribution } from "@/features/distribution/urls";
import { OnlineBookingSection } from "./OnlineBookingSection";
import styles from "./page.module.css";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const [locale, theme, requestHeaders] = await Promise.all([
    getRequestLocale(),
    getRequestTheme(),
    headers(),
  ]);
  // Public links come from configuration (NEXT_PUBLIC_APP_URL), never from the
  // host the owner is browsing on; the request host is only used as the
  // development-mode fallback so local links match the dev server's port.
  const { baseUrl, source } = getPublicBaseUrl(requestHeaders.get("host"));
  // Demo and real workspaces both have a public booking page (`/book/<slug>`);
  // the layout has already ensured the viewer may open this workspace.
  const isDemo = isDemoWorkspaceSlug(workspaceSlug);
  const distribution = baseUrl ? buildBookingDistribution(baseUrl, workspaceSlug) : null;
  const { nav, settings } = getMessages(locale);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{nav.settings}</h1>

      {!isDemoWorkspaceSlug(workspaceSlug) && (
        <Link href={`/${workspaceSlug}/settings/services`} className={styles.row}>
          <div className={styles.rowBody}>
            <p className={styles.rowLabel}>{settings.services.label}</p>
            <p className={styles.rowDescription}>{settings.services.description}</p>
          </div>
          <Icon name="chevronRight" size={18} />
        </Link>
      )}

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

      {!isDemoWorkspaceSlug(workspaceSlug) && (
        <form action={signOutAction} className={styles.row}>
          <div className={styles.rowBody}>
            <p className={styles.rowLabel}>{settings.account.label}</p>
          </div>
          <Button type="submit" variant="secondary" size="sm">
            {settings.account.signOut}
          </Button>
        </form>
      )}

      <OnlineBookingSection
        workspaceSlug={workspaceSlug}
        distribution={distribution}
        baseSource={source}
        labels={settings.onlineBooking}
        showDemoNote={isDemo}
      />
    </main>
  );
}
