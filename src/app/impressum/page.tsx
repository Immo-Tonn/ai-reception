import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage/LegalPage";
import styles from "@/components/legal/LegalPage/LegalPage.module.css";
import { impressumSections, missingImpressumFields, TODO } from "@/content/legal/impressum";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";

export async function generateMetadata(): Promise<Metadata> {
  const { legal } = getMessages(await getRequestLocale());
  return {
    title: `${legal.impressumTitle} — ServiceOS`,
    description: legal.impressumDescription,
    alternates: { canonical: "/impressum" },
    robots: { index: true, follow: true },
  };
}

/** Public, no auth. Canonical German text; surrounding UI is localized. */
export default async function ImpressumPage() {
  const { legal } = getMessages(await getRequestLocale());
  const hasMissing = missingImpressumFields().length > 0;

  return (
    <LegalPage title={legal.impressumTitle}>
      {hasMissing ? (
        <div className={styles.banner} role="note">
          <p className={styles.bannerTitle}>{legal.impressumDraftTitle}</p>
          <p className={styles.bannerBody}>{legal.impressumDraftBody}</p>
        </div>
      ) : null}

      {impressumSections.map((section) => (
        <section key={section.id} className={styles.section} aria-labelledby={`h-${section.id}`}>
          <h2 id={`h-${section.id}`} className={styles.sectionTitle}>
            {section.title}
          </h2>
          <dl className={styles.fields}>
            {section.fields.map((field) => (
              <div key={field.id} className={styles.field}>
                <dt className={styles.fieldLabel}>{field.label}</dt>
                <dd className={styles.fieldValue}>
                  {field.value === TODO ? (
                    <span className={styles.todo}>{legal.todoLabel}</span>
                  ) : (
                    field.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </LegalPage>
  );
}
