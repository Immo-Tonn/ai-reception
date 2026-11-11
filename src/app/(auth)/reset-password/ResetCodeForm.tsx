"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button, Input } from "@/components/ui";
import { withAudience, type RecoveryAudience } from "@/lib/auth/recoveryAudience";
import type { Messages } from "@/lib/i18n";
import { verifyResetCodeAction, type ResetState } from "@/server/actions/passwordReset.actions";
import { resetErrorText } from "../_components/resetErrorText";
import styles from "../login/page.module.css";

const initialState: ResetState = {};

export function ResetCodeForm({
  initialEmail,
  messages,
  errors,
  audience,
}: {
  initialEmail: string;
  messages: Messages["passwordReset"];
  errors: Messages["authErrors"];
  audience: RecoveryAudience;
}) {
  const [state, formAction, isPending] = useActionState(verifyResetCodeAction, initialState);
  const email = state.email ?? initialEmail;

  return (
    // suppressHydrationWarning: Chrome for iOS adds `__gcruniqueid` to forms before hydration.
    <form className={styles.form} action={formAction} suppressHydrationWarning>
      <input type="hidden" name="audience" value={audience} suppressHydrationWarning />
      <Input
        label={messages.emailLabel}
        type="email"
        name="email"
        autoComplete="email"
        required
        defaultValue={email}
        key={email}
      />
      <Input
        label={messages.codeLabel}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={12}
        required
      />
      {state.error ? (
        <p className={styles.formError} role="alert">
          {resetErrorText(state.error, messages, errors)}
        </p>
      ) : null}
      <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
        {isPending ? messages.verifying : messages.verify}
      </Button>
      <p className={styles.signupPrompt}>
        <Link className={styles.signupLink} href={withAudience("/forgot-password", audience)}>
          {messages.requestNew}
        </Link>
      </p>
    </form>
  );
}
