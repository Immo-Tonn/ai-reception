"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import { requestPasswordResetAction, type ResetState } from "@/server/actions/passwordReset.actions";
import { resetErrorText } from "../_components/resetErrorText";
import styles from "../login/page.module.css";

const initialState: ResetState = {};

export function ForgotPasswordForm({
  messages,
  errors,
}: {
  messages: Messages["passwordReset"];
  errors: Messages["authErrors"];
}) {
  const [state, formAction, isPending] = useActionState(requestPasswordResetAction, initialState);

  return (
    // suppressHydrationWarning: Chrome for iOS adds `__gcruniqueid` to forms before hydration.
    <form className={styles.form} action={formAction} suppressHydrationWarning>
      <Input
        label={messages.emailLabel}
        type="email"
        name="email"
        autoComplete="email"
        required
        defaultValue={state.email ?? ""}
        key={state.email ?? "email"}
      />
      {state.error ? (
        <p className={styles.formError} role="alert">
          {resetErrorText(state.error, messages, errors)}
        </p>
      ) : null}
      <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
        {isPending ? messages.sending : messages.sendCode}
      </Button>
    </form>
  );
}
