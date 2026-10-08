import { getRequestLocale } from "@/lib/i18n/next";
import { getMessages } from "@/lib/i18n";
import { isStagingEnv } from "@/lib/config/appEnv";
import styles from "./EnvironmentBadge.module.css";

/**
 * Small fixed "test environment" marker. Renders NOTHING unless
 * NEXT_PUBLIC_APP_ENV=staging. Pure decoration: pointer-events are off so it
 * can never block a tap, and it sits at the very top (safe-area aware), away
 * from the bottom navigation and booking controls.
 */
export async function EnvironmentBadge() {
  if (!isStagingEnv()) return null;
  const locale = await getRequestLocale();
  const { environment } = getMessages(locale);
  return (
    <div className={styles.badge} role="note" data-environment="staging">
      {environment.stagingBadge}
    </div>
  );
}
