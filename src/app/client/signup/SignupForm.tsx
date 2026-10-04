"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { Button, Input, PasswordInput } from "@/components/ui";
import { signUpClientAction } from "@/server/actions/clientAccount.actions";
import type { Messages } from "@/lib/i18n";
import { clientAuthHref } from "@/features/clientAccount/redirect";
import styles from "../client.module.css";

type ClientAuthFormState = Awaited<ReturnType<typeof signUpClientAction>>;
const initialState: ClientAuthFormState = {};

export function SignupForm({
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
  const [state, formAction, isPending] = useActionState(signUpClientAction, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const checkRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state.error) return;
    errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    errorRef.current?.focus({ preventScroll: true });
  }, [state]);

  useEffect(() => {
    if (state.checkEmail) checkRef.current?.focus();
  }, [state.checkEmail]);

  // Neutral on purpose: the same text whether or not the address already has an account.
  if (state.checkEmail) {
    return (
      <>
        <div ref={checkRef} tabIndex={-1} className={styles.form} role="status">
          <h2 className={styles.noticeTitle}>{messages.checkEmailTitle}</h2>
          <p className={styles.noticeText}>{messages.checkEmailBody}</p>
        </div>
        <p className={styles.promptRow}>
          <Link href={clientAuthHref("login", redirect)} className={styles.promptLink}>
            {messages.loginLink}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <form suppressHydrationWarning className={styles.form} action={formAction}>
        <input type="hidden" name="redirect" value={redirect} suppressHydrationWarning />
        <Input
          label={messages.nameLabel}
          type="text"
          name="fullName"
          autoComplete="name"
          maxLength={120}
          required
        />
        <Input
          label={messages.emailLabel}
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={state.email ?? ""}
          key={state.email ?? "email"}
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
        <p className={styles.fieldHint}>{messages.passwordHint}</p>
        {state.error ? (
          <p ref={errorRef} tabIndex={-1} className={styles.errorText} role="alert">
            {errors[state.error]}
          </p>
        ) : null}
        <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
          {isPending ? messages.submitting : messages.signupSubmit}
        </Button>
      </form>

      <p className={styles.promptRow}>
        {messages.loginPrompt}{" "}
        <Link href={clientAuthHref("login", redirect)} className={styles.promptLink}>
          {messages.loginLink}
        </Link>
      </p>
    </>
  );
}
