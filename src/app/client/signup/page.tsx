import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { BackLink } from "@/components/ui";
import { SignupForm } from "./SignupForm";
import styles from "../client.module.css";

export const metadata: Metadata = {
  title: "Create account — ServiceOS",
};

export default async function ClientSignupPage() {
  const locale = await getRequestLocale();
  const { client, common } = getMessages(locale);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <BackLink href="/client" label={common.backToClientArea} />
        <Preferences />
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{client.signupTitle}</h1>
        <p className={styles.subtitle}>{client.signupSubtitle}</p>
        <SignupForm messages={client} />
        <p className={styles.promptRow}>
          {client.businessPrompt}{" "}
          <a href="/business" className={styles.promptLink}>
            {client.businessLink}
          </a>
        </p>
      </div>
    </main>
  );
}
