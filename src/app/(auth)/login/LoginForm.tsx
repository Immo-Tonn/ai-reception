"use client";

import { useState, type FormEvent } from "react";
import { Button, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import styles from "./page.module.css";

export function LoginForm({ messages }: { messages: Messages["login"] }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    // TODO: wire up to Supabase Auth (lib/auth).
    setIsSubmitting(false);
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input
        label={messages.emailLabel}
        type="email"
        name="email"
        placeholder={messages.emailPlaceholder}
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Input
        label={messages.passwordLabel}
        type="password"
        name="password"
        placeholder="••••••••"
        autoComplete="current-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <Button type="submit" fullWidth disabled={isSubmitting}>
        {isSubmitting ? messages.submitting : messages.submit}
      </Button>
    </form>
  );
}
