import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui";
import { isRecoveryFlagExpired, RECOVERY_FLAG_COOKIE } from "@/lib/auth/recoveryFlag";
import { getMessages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getCurrentUserSafe } from "@/server/auth/supabaseBusinessAuth";
import { cancelPasswordResetAction } from "@/server/actions/passwordReset.actions";
import { AuthShell } from "../../_components/AuthShell";
import styles from "../../login/page.module.css";
import { NewPasswordForm } from "./NewPasswordForm";

export const metadata: Metadata = {
  title: "New password — ServiceOS",
};

export default async function NewPasswordPage() {
  // Only reachable right after a correct recovery code: that is what created the session and the flag.
  if (!(await getCurrentUserSafe())) redirect("/forgot-password");
  const flag = (await cookies()).get(RECOVERY_FLAG_COOKIE)?.value;
  if (flag === undefined) redirect("/login");

  const locale = await getRequestLocale();
  const { passwordReset, authErrors, common } = getMessages(locale);

  if (isRecoveryFlagExpired(flag)) {
    return (
      <AuthShell>
        <div className={styles.formHeader}>
          <h1 className={styles.formTitle}>{passwordReset.newTitle}</h1>
        </div>
        <p className={styles.formError} role="status">
          {passwordReset.expiredNotice}
        </p>
        <form action={cancelPasswordResetAction} suppressHydrationWarning>
          <Button type="submit" fullWidth>
            {passwordReset.requestNew}
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className={styles.formHeader}>
        <h1 className={styles.formTitle}>{passwordReset.newTitle}</h1>
        <p className={styles.formSubtitle}>{passwordReset.newSubtitle}</p>
      </div>
      <NewPasswordForm
        messages={passwordReset}
        errors={authErrors}
        passwordLabels={{ show: common.showPassword, hide: common.hidePassword }}
      />
      <form action={cancelPasswordResetAction} suppressHydrationWarning>
        <Button type="submit" variant="secondary" fullWidth>
          {passwordReset.cancel}
        </Button>
      </form>
    </AuthShell>
  );
}
