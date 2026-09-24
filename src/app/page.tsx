import Link from "next/link";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { Icon } from "@/components/ui";
import styles from "./page.module.css";

/**
 * The neutral first screen — deliberately says nothing business-specific
 * or client-specific. ServiceOS is one platform connecting a service
 * business with the people who book its services; this screen just
 * offers the two doors in, each with its own message living one level
 * down (`/business`, `/client`) — not two competing sales pitches on the
 * same screen (§ root must stay neutral, no two-card role selector).
 */
export default async function Home() {
  const locale = await getRequestLocale();
  const { home } = getMessages(locale);

  return (
    <main className={styles.hero}>
      <div className={styles.meshLayerC} aria-hidden="true" />
      <div className={styles.topBar}>
        <Preferences />
      </div>

      <div className={styles.content}>
        <span className={styles.eyebrow}>{home.eyebrow}</span>
        <h1 className={styles.title}>{home.title}</h1>
        <p className={styles.subtitle}>{home.subtitle}</p>

        <div className={styles.actionList}>
          <Link href="/business" className={styles.actionRow}>
            <span className={styles.actionLabel}>{home.rowBusiness}</span>
            <span className={styles.actionArrow} aria-hidden="true">
              <Icon name="arrowRight" size={12} strokeWidth={1.8} />
            </span>
          </Link>
          <Link href="/client" className={styles.actionRow}>
            <span className={styles.actionLabel}>{home.rowClient}</span>
            <span className={styles.actionArrow} aria-hidden="true">
              <Icon name="arrowRight" size={12} strokeWidth={1.8} />
            </span>
          </Link>
        </div>

        <a className={styles.tertiaryLink} href="/demo/today">
          {home.ctaSecondary}
        </a>
      </div>
    </main>
  );
}
