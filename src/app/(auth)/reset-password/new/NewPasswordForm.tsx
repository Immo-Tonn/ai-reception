"use client";

import { useActionState } from "react";
import { Button, PasswordInput } from "@/components/ui";
import type { RecoveryAudience } from "@/lib/auth/recoveryAudience";
import type { Messages } from "@/lib/i18n";
import { setNewPasswordAction, type ResetState } from "@/server/actions/passwordReset.actions";
import { resetErrorText } from "../../_components/resetErrorText";
import styles from "../../login/page.module.css";

const initialState: ResetState = {};

export function NewPasswordForm({
  messages,
  errors,
  passwordLabels,
  audience,
}: {
  messages: Messages["passwordReset"];
  errors: Messages["authErrors"];
  passwordLabels: { show: string; hide: string };
  audience: RecoveryAudience;
}) {
  const [state, formAction, isPending] = useActionState(setNewPasswordAction, initialState);

  return (
    // suppressHydrationWarning: Chrome for iOS adds `__gcruniqueid` to forms before hydration.
    <form className={styles.form} action={formAction} suppressHydrationWarning>
      <input type="hidden" name="audience" value={audience} suppressHydrationWarning />
      <PasswordInput
        label={messages.newPasswordLabel}
        showLabel={passwordLabels.show}
        hideLabel={passwordLabels.hide}
        name="password"
        autoComplete="new-password"
        required
      />
      <PasswordInput
        label={messages.confirmPasswordLabel}
        showLabel={passwordLabels.show}
        hideLabel={passwordLabels.hide}
        name="confirm"
        autoComplete="new-password"
        required
      />
      {state.error ? (
        <p className={styles.formError} role="alert">
          {resetErrorText(state.error, messages, errors)}
        </p>
      ) : null}
      <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
        {isPending ? messages.saving : messages.savePassword}
      </Button>
    </form>
  );
}
