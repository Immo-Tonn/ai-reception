import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { Preferences } from "@/components/layout/Preferences/Preferences";
import { BackLink } from "@/components/ui";
import { LoginForm } from "./LoginForm";
import styles from "../client.module.css";

export const metadata: Metadata = {
  title: "Sign in — ServiceOS",
};

export default async function ClientLoginPage() {
  const locale = await getRequestLocale();
  const { client, common } = getMessages(locale);

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <BackLink href="/client" label={common.backToClientArea} />
        <Preferences />
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{client.loginTitle}</h1>
        <p className={styles.subtitle}>{client.loginSubtitle}</p>
        <LoginForm messages={client} />
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
