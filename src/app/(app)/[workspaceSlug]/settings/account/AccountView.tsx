"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { Button, Icon, PasswordInput } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import { changePasswordAction } from "@/server/actions/account.actions";
import base from "../services/page.module.css";
import styles from "./page.module.css";

const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;

export function AccountView({
  workspaceSlug,
  messages,
  errors,
  passwordLabels,
  backLabel,
}: {
  workspaceSlug: string;
  messages: Messages["settingsAccount"];
  errors: Messages["authErrors"];
  passwordLabels: { show: string; hide: string };
  backLabel: string;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
      return setError(errors.weak_password);
    }
    if (newPassword !== confirmPassword) return setError(messages.passwordMismatch);
    if (newPassword === currentPassword) return setError(messages.passwordSame);

    startTransition(async () => {
      const result = await changePasswordAction(workspaceSlug, currentPassword, newPassword);
      if (result.ok) {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setDone(true);
      } else {
        setError(result.code === "invalid_credentials" ? messages.currentPasswordWrong : errors[result.code]);
      }
    });
  }

  return (
    <main className={base.page}>
      <header className={base.header}>
        <Link href={`/${workspaceSlug}/settings`} className={base.backButton} aria-label={backLabel}>
          <Icon name="chevronRight" size={18} style={{ transform: "rotate(180deg)" }} />
        </Link>
        <div>
          <h1 className={base.title}>{messages.title}</h1>
          <p className={base.subtitle}>{messages.subtitle}</p>
        </div>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{messages.passwordTitle}</h2>
        {/* suppressHydrationWarning: Chrome for iOS adds `__gcruniqueid` to forms before hydration. */}
        <form className={styles.form} onSubmit={handleSubmit} suppressHydrationWarning>
          <PasswordInput
            label={messages.currentPasswordLabel}
            showLabel={passwordLabels.show}
            hideLabel={passwordLabels.hide}
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
          <PasswordInput
            label={messages.newPasswordLabel}
            showLabel={passwordLabels.show}
            hideLabel={passwordLabels.hide}
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
          <PasswordInput
            label={messages.confirmPasswordLabel}
            showLabel={passwordLabels.show}
            hideLabel={passwordLabels.hide}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
          {error && (
            <p className={base.error} role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className={styles.success} role="status">
              {messages.passwordChanged}
            </p>
          )}
          <div>
            <Button
              type="submit"
              disabled={isPending || !currentPassword || !newPassword || !confirmPassword}
              aria-busy={isPending}
            >
              {isPending ? messages.changing : messages.changePassword}
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
