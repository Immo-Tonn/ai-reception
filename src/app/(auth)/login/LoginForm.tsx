"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button, Input, PasswordInput } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import { signInOwnerAction, type LoginState } from "./actions";
import styles from "./page.module.css";

const initialState: LoginState = {};

export function LoginForm({
  messages,
  errors,
  passwordLabels,
}: {
  messages: Messages["login"];
  errors: Messages["authErrors"];
  passwordLabels: { show: string; hide: string };
}) {
  const [state, formAction, isPending] = useActionState(signInOwnerAction, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // A failed sign-in must be SEEN: the message sits right above the button (not at the top of a
  // tall form) and is scrolled into view and announced, so a submit never looks like a reload.
  useEffect(() => {
    if (!state.error) return;
    errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    errorRef.current?.focus({ preventScroll: true });
  }, [state]);

  return (
    // suppressHydrationWarning: Chrome for iOS adds `__gcruniqueid` to forms before hydration.
    <form className={styles.form} action={formAction} suppressHydrationWarning>
      <Input
        label={messages.emailLabel}
        type="email"
        name="email"
        placeholder={messages.emailPlaceholder}
        autoComplete="email"
        required
        // React resets uncontrolled fields after a form action; the e-mail comes back with the
        // result so the person does not have to retype it. The password is never echoed.
        defaultValue={state.email ?? ""}
        key={state.email ?? "email"}
      />
      <PasswordInput
        label={messages.passwordLabel}
        showLabel={passwordLabels.show}
        hideLabel={passwordLabels.hide}
        name="password"
        placeholder="••••••••"
        autoComplete="current-password"
        required
      />
      {state.error ? (
        <p ref={errorRef} tabIndex={-1} className={styles.formError} role="alert">
          {errors[state.error]}
        </p>
      ) : null}
      <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
        {isPending ? messages.submitting : messages.submit}
      </Button>
    </form>
  );
}
