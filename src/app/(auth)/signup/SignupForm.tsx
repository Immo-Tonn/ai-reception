"use client";

import { useActionState } from "react";
import { Button, Input, PasswordInput } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import { signUpOwnerAction, type SignupState } from "./actions";
import styles from "../login/page.module.css";

const initialState: SignupState = {};

export function SignupForm({
  messages,
  errors,
  passwordLabels,
}: {
  messages: Messages["signup"];
  errors: Messages["authErrors"];
  passwordLabels: { show: string; hide: string };
}) {
  const [state, formAction, isPending] = useActionState(signUpOwnerAction, initialState);

  if (state.checkEmail) {
    return (
      <div className={styles.form} role="status">
        <h2 className={styles.formTitle}>{messages.checkEmailTitle}</h2>
        <p className={styles.formSubtitle}>{messages.checkEmailBody}</p>
      </div>
    );
  }

  return (
    <form className={styles.form} action={formAction} suppressHydrationWarning>
      {state.error ? (
        <p className={styles.formError} role="alert">
          {errors[state.error]}
        </p>
      ) : null}
      <Input
        label={messages.businessNameLabel}
        type="text"
        name="businessName"
        placeholder={messages.businessNamePlaceholder}
        autoComplete="organization"
        maxLength={120}
        required
      />
      <Input
        label={messages.emailLabel}
        type="email"
        name="email"
        placeholder={messages.emailPlaceholder}
        autoComplete="email"
        required
      />
      <PasswordInput
        label={messages.passwordLabel}
        showLabel={passwordLabels.show}
        hideLabel={passwordLabels.hide}
        name="password"
        placeholder="••••••••"
        autoComplete="new-password"
        minLength={8}
        maxLength={72}
        required
      />
      <Button type="submit" fullWidth disabled={isPending}>
        {isPending ? messages.submitting : messages.submit}
      </Button>
    </form>
  );
}
