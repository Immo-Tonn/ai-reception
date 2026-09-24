"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Icon } from "@/components/ui";
import { useClientAuth } from "@/features/clientAuth/useClientAuth";
import type { Messages } from "@/lib/i18n";
import styles from "../client.module.css";

export function SignupForm({ messages }: { messages: Messages["client"] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn } = useClientAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !email.trim() || !password.trim()) {
      setError(messages.validationRequired);
      return;
    }
    setError(null);
    setSubmitting(true);
    signIn({ name: name.trim(), email: email.trim(), phone: phone.trim() });
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
          label={messages.nameLabel}
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Input
          label={messages.emailLabel}
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Input
          label={messages.phoneLabel}
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
        />
        <Input
          label={messages.passwordLabel}
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <p className={styles.errorText}>{error}</p>}
        <Button type="submit" fullWidth disabled={submitting}>
          {submitting ? messages.submitting : messages.signupSubmit}
        </Button>
      </form>

      <p className={styles.promptRow}>
        {messages.loginPrompt}{" "}
        <a href="/client/login" className={styles.promptLink}>
          {messages.loginLink}
        </a>
      </p>
    </>
  );
}
