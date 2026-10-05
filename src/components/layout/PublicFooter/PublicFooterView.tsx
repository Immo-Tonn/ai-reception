import Link from "next/link";
import { getMessages, type Locale } from "@/lib/i18n";
import styles from "./PublicFooter.module.css";

export const LABRITY_URL = "https://www.labrity.com/";

/**
 * Pure presentation of the public footer (no request access) so it can be
 * rendered and tested for any locale and year. Use `PublicFooter` in pages.
 */
export function PublicFooterView({ locale, year }: { locale: Locale; year: number }) {
  const { legal } = getMessages(locale);

  return (
    <footer className={styles.footer}>
      <p className={styles.item}>© {year} ServiceOS</p>
      <nav aria-label={legal.footerNavLabel} className={styles.nav}>
        <Link href="/impressum" prefetch={false} className={styles.link}>
          {legal.impressumLabel}
        </Link>
        <Link href="/datenschutz" prefetch={false} className={styles.link}>
          {legal.datenschutzLabel}
        </Link>
      </nav>
      <p className={styles.item}>{legal.footerRights}</p>
      <p className={styles.item}>
        {legal.footerDevelopedBy}{" "}
        <a
          href={LABRITY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
          aria-label={legal.labrityLinkLabel}
        >
          Labrity Web Studio
        </a>
      </p>
    </footer>
  );
}
