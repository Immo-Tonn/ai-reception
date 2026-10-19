import type { Metadata } from "next";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { AuthShell } from "../_components/AuthShell";
import styles from "../login/page.module.css";
import { ResetCodeForm } from "./ResetCodeForm";

export const metadata: Metadata = {
  title: "Enter code — ServiceOS",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  const locale = await getRequestLocale();
  const { passwordReset, authErrors } = getMessages(locale);

  return (
    <AuthShell>
      <div className={styles.formHeader}>
        <h1 className={styles.formTitle}>{passwordReset.codeTitle}</h1>
        <p className={styles.formSubtitle}>{passwordReset.codeSubtitle}</p>
      </div>
      <ResetCodeForm initialEmail={email ?? ""} messages={passwordReset} errors={authErrors} />
    </AuthShell>
  );
}
