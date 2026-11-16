import type { Metadata } from "next";
import { parseRecoveryAudience } from "@/lib/auth/recoveryAudience";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { AuthShell } from "../_components/AuthShell";
import styles from "../login/page.module.css";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export const metadata: Metadata = {
  title: "Forgot password — ServiceOS",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; for?: string }>;
}) {
  const { expired, for: audienceParam } = await searchParams;
  const audience = parseRecoveryAudience(audienceParam);
  const locale = await getRequestLocale();
  const { passwordReset, authErrors } = getMessages(locale);

  return (
    <AuthShell audience={audience}>
      <div className={styles.formHeader}>
        <h1 className={styles.formTitle}>{passwordReset.forgotTitle}</h1>
        <p className={styles.formSubtitle}>{passwordReset.forgotSubtitle}</p>
      </div>
      {expired ? (
        <p className={styles.formError} role="status">
          {passwordReset.expiredNotice}
        </p>
      ) : null}
      <ForgotPasswordForm messages={passwordReset} errors={authErrors} audience={audience} />
    </AuthShell>
  );
}
