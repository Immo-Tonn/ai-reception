import type { Metadata } from "next";
import { Button } from "@/components/ui";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { LoginForm } from "./LoginForm";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Sign in — ServiceOS",
};

export default async function LoginPage() {
  const locale = await getRequestLocale();
  const { login } = getMessages(locale);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <Preferences />
      </div>

      <div className={styles.body}>
        <section className={styles.brandPanel}>
          <span className={styles.logo}>ServiceOS</span>
          <div className={styles.brandContent}>
            <h1 className={styles.brandTitle}>{login.brandTitle}</h1>
            <p className={styles.brandSubtitle}>{login.brandSubtitle}</p>
          </div>
          <span className={styles.brandFoot}>© {new Date().getFullYear()} ServiceOS</span>
        </section>

        <section className={styles.formPanel}>
          <div className={styles.formCard}>
            <div className={styles.formHeader}>
              <h2 className={styles.formTitle}>{login.title}</h2>
              <p className={styles.formSubtitle}>{login.subtitle}</p>
            </div>

            <LoginForm messages={login} />

            <div className={styles.formFoot}>
              <span className={styles.divider}>{login.orDivider}</span>
              <Button variant="secondary" fullWidth type="button">
                {login.googleButton}
              </Button>
            </div>

            <p className={styles.signupPrompt}>
              {login.signupPrompt}{" "}
              <a className={styles.signupLink} href="/signup">
                {login.signupLink}
              </a>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
