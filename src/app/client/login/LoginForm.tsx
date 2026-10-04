"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { Button, Input, PasswordInput } from "@/components/ui";
import { signInClientAction } from "@/server/actions/clientAccount.actions";
import type { Messages } from "@/lib/i18n";
import { clientAuthHref } from "@/features/clientAccount/redirect";
import styles from "../client.module.css";

type ClientAuthFormState = Awaited<ReturnType<typeof signInClientAction>>;
const initialState: ClientAuthFormState = {};

export function LoginForm({
  messages,
  errors,
  passwordLabels,
  redirect,
}: {
  messages: Messages["client"];
  errors: Messages["authErrors"];
  passwordLabels: { show: string; hide: string };
  /** Already sanitized on the server page; the server action validates it again. */
  redirect: string;
}) {
  const [state, formAction, isPending] = useActionState(signInClientAction, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // A failed sign-in must be SEEN and announced, not look like a silent reload.
  useEffect(() => {
    if (!state.error) return;
    errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    errorRef.current?.focus({ preventScroll: true });
  }, [state]);

  return (
    <>
      <form suppressHydrationWarning className={styles.form} action={formAction}>
        <input type="hidden" name="redirect" value={redirect} suppressHydrationWarning />
        <Input
          label={messages.emailLabel}
          type="email"
          name="email"
          autoComplete="email"
          required
          // The e-mail comes back with the result so it need not be retyped; the password never does.
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
          <p ref={errorRef} tabIndex={-1} className={styles.errorText} role="alert">
            {errors[state.error]}
          </p>
        ) : null}
        <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
          {isPending ? messages.submitting : messages.loginSubmit}
        </Button>
      </form>

      <p className={styles.promptRow}>
        {messages.signupPrompt}{" "}
        <Link href={clientAuthHref("signup", redirect)} className={styles.promptLink}>
          {messages.signupLink}
        </Link>
      </p>
    </>
  );
}
