"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import { completeGoogleSignUpAction, cancelGoogleSignUpAction, type GoogleSignupState } from "./actions";
import styles from "../../login/page.module.css";

const initialState: GoogleSignupState = {};

export function GoogleSignupForm({ messages, errors }: { messages: Messages["googleAuth"]; errors: Messages["authErrors"] }) {
  const [state, formAction, isPending] = useActionState(completeGoogleSignUpAction, initialState);
  return (
    <>
      <form className={styles.form} action={formAction} suppressHydrationWarning>
        <Input
          label={messages.businessNameLabel}
          name="businessName"
          autoComplete="organization"
          required
          maxLength={120}
          suppressHydrationWarning
          defaultValue={state.businessName ?? ""}
          key={state.businessName ?? "businessName"}
        />
        {state.error ? (
          <p className={styles.formError} role="alert">
            {errors[state.error]}
          </p>
        ) : null}
        <Button type="submit" fullWidth disabled={isPending} aria-busy={isPending}>
          {isPending ? messages.submitting : messages.submit}
        </Button>
      </form>
      <form action={cancelGoogleSignUpAction} suppressHydrationWarning>
        <Button type="submit" variant="secondary" fullWidth>
          {messages.cancel}
        </Button>
      </form>
    </>
  );
}
