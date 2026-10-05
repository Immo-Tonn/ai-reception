import type { ReactNode } from "react";
import { BackLink } from "@/components/ui";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { PublicFooter } from "@/components/layout/PublicFooter/PublicFooter";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import styles from "./LegalPage.module.css";

/**
 * Shared chrome of the public legal pages (/impressum, /datenschutz):
 * back link, preferences, readable column, public footer. Public, no auth.
 */
export async function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const locale = await getRequestLocale();
  const { legal } = getMessages(locale);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <BackLink href="/" label={legal.back} />
        <Preferences />
      </div>
      <article className={styles.body}>
        <h1 className={styles.title}>{title}</h1>
        {locale !== "de" ? <p className={styles.note}>{legal.germanOriginalNote}</p> : null}
        {children}
      </article>
      <PublicFooter />
    </main>
  );
}
