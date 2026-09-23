"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import styles from "../login/page.module.css";

export function SignupForm({ messages }: { messages: Messages["signup"] }) {
  const router = useRouter();
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    // TODO: wire up to Supabase Auth + workspace creation (lib/auth).
    router.push("/onboarding");
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input
        label={messages.businessNameLabel}
        type="text"
        name="businessName"
        placeholder={messages.businessNamePlaceholder}
        autoComplete="organization"
        required
        value={businessName}
        onChange={(event) => setBusinessName(event.target.value)}
      />
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
        autoComplete="new-password"
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
