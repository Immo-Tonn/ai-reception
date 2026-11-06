import type { Metadata } from "next";
import { parseRecoveryAudience } from "@/lib/auth/recoveryAudience";
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
  searchParams: Promise<{ email?: string; for?: string }>;
}) {
  const { email, for: audienceParam } = await searchParams;
  const audience = parseRecoveryAudience(audienceParam);
  const locale = await getRequestLocale();
  const { passwordReset, authErrors } = getMessages(locale);

  return (
    <AuthShell audience={audience}>
      <div className={styles.formHeader}>
        <h1 className={styles.formTitle}>{passwordReset.codeTitle}</h1>
        <p className={styles.formSubtitle}>{passwordReset.codeSubtitle}</p>
      </div>
      <ResetCodeForm initialEmail={email ?? ""} messages={passwordReset} errors={authErrors} audience={audience} />
    </AuthShell>
  );
}
