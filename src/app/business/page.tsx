import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import styles from "../client/client.module.css";

export const metadata: Metadata = {
  title: "ServiceOS for business",
};

/**
 * Business intro — reached from the neutral root's "Manage a business"
 * action. Carries the message that used to sit directly on `/` (§ root
 * must stay neutral; this is where the business-specific pitch actually
 * belongs). Shares its screen chrome with the Client intro via
 * `client.module.css` (same `.screen`/`.introBody`/intro-button classes)
 * rather than duplicating the CSS.
 */
export default async function BusinessIntroPage() {
  const locale = await getRequestLocale();
  const { business } = getMessages(locale);

  return (
    <main className={styles.heroScreen}>
      <div className={styles.heroMeshLayerC} aria-hidden="true" />
      <div className={styles.topBar}>
        <Link href="/" className={styles.backLink}>
          ← {business.backToHome}
        </Link>
        <Preferences />
      </div>

      <div className={styles.introBody}>
        <h1 className={styles.introTitle}>{business.title}</h1>
        <p className={styles.introSubtitle}>{business.subtitle}</p>

        <Link href="/signup" className={styles.introPrimaryButton}>
          {business.ctaSignup}
        </Link>
        <Link href="/login" className={styles.introSecondaryButton}>
          {business.ctaLogin}
        </Link>

        <p className={styles.promptRow}>
          {business.clientPrompt}{" "}
          <Link href="/client" className={styles.promptLink}>
            {business.clientLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
