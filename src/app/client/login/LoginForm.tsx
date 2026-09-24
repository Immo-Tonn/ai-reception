"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Icon } from "@/components/ui";
import { useClientAuth } from "@/features/clientAuth/useClientAuth";
import type { Messages } from "@/lib/i18n";
import styles from "../client.module.css";

export function LoginForm({ messages }: { messages: Messages["client"] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useClientAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError(messages.validationRequired);
      return;
    }
    setError(null);
    setSubmitting(true);
    // No real account store yet (§ "не делай fake production auth") — the
    // password is never checked against anything. Signing in just means
    // this browser now remembers the email as "you" for My Bookings.
    signIn({ name: email.split("@")[0], email: email.trim(), phone: "" });
    const redirectTo = searchParams.get("redirect") ?? "/client/bookings";
    router.push(redirectTo);
    setSubmitting(false);
  }

  return (
    <>
      <button type="button" className={styles.googleButton} disabled aria-label={messages.googleDemoNote}>
        <Icon name="globe" size={18} aria-hidden="true" />
        {messages.googleButton}
      </button>
      <p className={styles.googleNote}>{messages.googleDemoNote}</p>

      <div className={styles.divider}>{messages.orDivider}</div>

      <form className={styles.form} onSubmit={handleSubmit}>
        <Input
          label={messages.emailLabel}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label={messages.passwordLabel}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p className={styles.errorText}>{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? messages.submitting : messages.loginSubmit}
        </Button>
      </form>

      <p className={styles.promptRow}>
        {messages.signupPrompt}{" "}
        <a href="/client/signup" className={styles.promptLink}>
          {messages.signupLink}
        </a>
      </p>
    </>
  );
}
