"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import { signUpOwnerAction, type SignupState } from "./actions";
import styles from "../login/page.module.css";

const initialState: SignupState = {};

export function SignupForm({ messages }: { messages: Messages["signup"] }) {
  const [state, formAction, isPending] = useActionState(signUpOwnerAction, initialState);

  return (
    <form className={styles.form} action={formAction}>
      {state.error ? <p className={styles.formError}>{state.error}</p> : null}
      <Input
        label={messages.businessNameLabel}
        type="text"
        name="businessName"
        placeholder={messages.businessNamePlaceholder}
        autoComplete="organization"
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
      <Input
        label={messages.passwordLabel}
        type="password"
        name="password"
        placeholder="••••••••"
        autoComplete="new-password"
        required
      />
      <Button type="submit" fullWidth disabled={isPending}>
        {isPending ? messages.submitting : messages.submit}
      </Button>
    </form>
  );
}
