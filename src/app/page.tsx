import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import styles from "./page.module.css";

export default async function Home() {
  const locale = await getRequestLocale();
  const { home } = getMessages(locale);

  return (
    <main className={styles.hero}>
      <div className={styles.topBar}>
        <Preferences />
      </div>

      <div className={styles.content}>
        <span className={styles.eyebrow}>{home.eyebrow}</span>
        <h1 className={styles.title}>{home.title}</h1>
        <p className={styles.subtitle}>{home.subtitle}</p>
        <div className={styles.actions}>
          <a className={styles.primaryButton} href="/login">
            {home.ctaPrimary}
          </a>
          <a className={styles.secondaryButton} href="/demo/today">
            {home.ctaSecondary}
          </a>
        </div>
      </div>
    </main>
  );
}
