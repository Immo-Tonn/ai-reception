import type { ReactNode } from "react";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { PublicFooter } from "@/components/layout/PublicFooter/PublicFooter";
import { BackLink } from "@/components/ui";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import styles from "../login/page.module.css";

/** Single-card screen for the password-reset pages (same look as sign-in, without the brand panel). */
export async function AuthShell({ children }: { children: ReactNode }) {
  const { login } = getMessages(await getRequestLocale());
  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <BackLink href="/login" label={login.backToSignIn} />
        <Preferences />
      </div>
      <section className={styles.formPanel}>
        <div className={styles.formCard}>{children}</div>
      </section>
      <PublicFooter />
    </main>
  );
}
