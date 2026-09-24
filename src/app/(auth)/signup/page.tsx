import type { Metadata } from "next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { BackLink } from "@/components/ui";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { SignupForm } from "./SignupForm";
import styles from "../login/page.module.css";

export const metadata: Metadata = {
  title: "Create a workspace — ServiceOS",
};

export default async function SignupPage() {
  const locale = await getRequestLocale();
  const { signup, common } = getMessages(locale);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <BackLink href="/business" label={common.backToBusiness} />
        <Preferences />
      </div>

      <div className={styles.body}>
        <section className={styles.brandPanel}>
          <span className={styles.logo}>ServiceOS</span>
          <div className={styles.brandContent}>
            <h1 className={styles.brandTitle}>{signup.brandTitle}</h1>
            <p className={styles.brandSubtitle}>{signup.brandSubtitle}</p>
          </div>
          <span className={styles.brandFoot}>© {new Date().getFullYear()} ServiceOS</span>
        </section>

        <section className={styles.formPanel}>
          <div className={styles.formCard}>
            <div className={styles.formHeader}>
              <span className={styles.businessBadge}>{signup.businessBadge}</span>
              <h2 className={styles.formTitle}>{signup.title}</h2>
              <p className={styles.formSubtitle}>{signup.subtitle}</p>
            </div>

            <SignupForm messages={signup} />

            <p className={styles.signupPrompt}>
              {signup.loginPrompt}{" "}
              <a className={styles.signupLink} href="/login">
                {signup.loginLink}
              </a>
            </p>

            <p className={styles.signupPrompt}>
              {signup.clientPrompt}{" "}
              <a className={styles.signupLink} href="/client">
                {signup.clientLink}
              </a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
