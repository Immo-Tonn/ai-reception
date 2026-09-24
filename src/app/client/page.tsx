import Link from "next/link";
import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import styles from "./client.module.css";

export const metadata: Metadata = {
  title: "Book an appointment — ServiceOS",
};

/**
 * Client intro — reached from the neutral root's "Book a service" action.
 * Its own message and actions, entirely separate from the Business intro
 * (`/business`): no mention of invoices, CRM, staff management or
 * financial buckets, none of which a client ever sees (§ Client branch
 * must not leak business-admin language).
 */
export default async function ClientIntroPage() {
  const locale = await getRequestLocale();
  const { client } = getMessages(locale);

  return (
    <main className={styles.heroScreen}>
      <div className={styles.heroMeshLayerC} aria-hidden="true" />
      <div className={styles.topBar}>
        <Link href="/" className={styles.backLink}>
          ← {client.backToHome}
        </Link>
        <Preferences />
      </div>

      <div className={styles.introBody}>
        <h1 className={styles.introTitle}>{client.introTitle}</h1>
        <p className={styles.introSubtitle}>{client.introSubtitle}</p>

        <Link href="/client/book" className={styles.introPrimaryButton}>
          {client.introBookCta}
        </Link>
        <Link href="/client/bookings" className={styles.introSecondaryButton}>
          {client.introBookingsCta}
        </Link>

        <p className={styles.promptRow}>
          {client.loginPrompt}{" "}
          <Link href="/client/login" className={styles.promptLink}>
            {client.loginLink}
          </Link>
          {" · "}
          <Link href="/client/signup" className={styles.promptLink}>
            {client.signupLink}
          </Link>
        </p>

        <p className={styles.promptRow}>
          {client.businessPrompt}{" "}
          <Link href="/business" className={styles.promptLink}>
            {client.businessLink}
          </Link>
        </p>
      </div>
    </main>
  );
}
