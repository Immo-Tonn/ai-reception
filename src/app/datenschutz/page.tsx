import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage/LegalPage";
import styles from "@/components/legal/LegalPage/LegalPage.module.css";
import { datenschutzApproved, datenschutzLastUpdated, datenschutzSections } from "@/content/legal/datenschutz";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";

export async function generateMetadata(): Promise<Metadata> {
  const { legal } = getMessages(await getRequestLocale());
  return {
    title: `${legal.datenschutzTitle} — ServiceOS`,
    description: legal.datenschutzDescription,
    alternates: { canonical: "/datenschutz" },
    robots: { index: true, follow: true },
  };
}

/**
 * Public, no auth. Layout only: NO legal text exists yet. While
 * `datenschutzApproved` is false a loud draft banner is shown; the release
 * check `npm run check:legal` fails until real, reviewed text replaces it.
 */
export default async function DatenschutzPage() {
  const { legal } = getMessages(await getRequestLocale());

  return (
    <LegalPage title={legal.datenschutzTitle}>
      {!datenschutzApproved ? (
        <div className={styles.banner} role="note">
          <p className={styles.bannerTitle}>{legal.datenschutzDraftTitle}</p>
          <p className={styles.bannerBody}>{legal.datenschutzDraftBody}</p>
        </div>
      ) : null}

      <p className={styles.meta}>
        {legal.lastUpdatedLabel}: {datenschutzLastUpdated ?? legal.lastUpdatedPending}
      </p>

      <nav className={styles.toc} aria-labelledby="toc-title">
        <h2 id="toc-title" className={styles.tocTitle}>
          {legal.tocTitle}
        </h2>
        <ol className={styles.tocList}>
          {datenschutzSections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className={styles.tocLink}>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {datenschutzSections.map((s) => (
        <section key={s.id} id={s.id} className={styles.section} aria-labelledby={`h-${s.id}`}>
          <h2 id={`h-${s.id}`} className={styles.sectionTitle}>
            {s.title}
          </h2>
          <p className={styles.pending}>{legal.sectionPending}</p>
        </section>
      ))}
    </LegalPage>
  );
}
