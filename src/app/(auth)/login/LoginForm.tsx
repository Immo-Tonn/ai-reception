"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import { signInOwnerAction, type LoginState } from "./actions";
import styles from "./page.module.css";

const initialState: LoginState = {};

export function LoginForm({
  messages,
  errors,
}: {
  messages: Messages["login"];
  errors: Messages["authErrors"];
}) {
  const [state, formAction, isPending] = useActionState(signInOwnerAction, initialState);

  return (
    <form className={styles.form} action={formAction}>
      {state.error ? (
        <p className={styles.formError} role="alert">
          {errors[state.error]}
        </p>
      ) : null}
      <Input
        label={messages.emailLabel}
        type="email"
        name="email"
        placeholder={messages.emailPlaceholder}
        autoComplete="email"
        required
      />
      <Input
        label={messages.passwordLabel}
        type="password"
        name="password"
        placeholder="••••••••"
        autoComplete="current-password"
        required
      />
      <Button type="submit" fullWidth disabled={isPending}>
        {isPending ? messages.submitting : messages.submit}
      </Button>
    </form>
  );
}
