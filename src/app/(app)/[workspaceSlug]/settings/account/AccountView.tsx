"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Icon, Input } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import {
  changePasswordAction,
  deleteRegistrationAction,
} from "@/server/actions/account.actions";
import base from "../services/page.module.css";
import styles from "./page.module.css";

export function AccountView({
  workspaceSlug,
  messages,
  backLabel,
}: {
  workspaceSlug: string;
  messages: Messages["settingsAccount"];
  backLabel: string;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordDone, setPasswordDone] = useState(false);
  const [typedSlug, setTypedSlug] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleChangePassword() {
    setPasswordError(null);
    setPasswordDone(false);
    if (password.length < 6) return setPasswordError(messages.passwordTooShort);
    if (password !== confirm) return setPasswordError(messages.passwordMismatch);
    startTransition(async () => {
      const result = await changePasswordAction(workspaceSlug, password);
      if (result.ok) {
        setPassword("");
        setConfirm("");
        setPasswordDone(true);
      } else {
        setPasswordError(
          result.error === "password_too_short" ? messages.passwordTooShort : messages.errorGeneric,
        );
      }
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteRegistrationAction(workspaceSlug, typedSlug);
      if (result.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setDeleteError(messages.errorGeneric);
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
        {passwordError && <p className={base.error}>{passwordError}</p>}
        {passwordDone && <p className={styles.success}>{messages.passwordChanged}</p>}
        <Input
          label={messages.newPasswordLabel}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Input
          label={messages.confirmPasswordLabel}
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
        <div>
          <Button type="button" onClick={handleChangePassword} disabled={isPending || !password}>
            {messages.changePassword}
          </Button>
        </div>
      </section>

      <section className={`${styles.section} ${styles.danger}`}>
        <h2 className={styles.sectionTitle}>{messages.deleteTitle}</h2>
        <p className={styles.warning}>{messages.deleteWarning}</p>
        {deleteError && <p className={base.error}>{deleteError}</p>}
        <Input
          label={messages.deleteConfirmLabel.replace("{slug}", workspaceSlug)}
          value={typedSlug}
          onChange={(event) => setTypedSlug(event.target.value)}
          autoComplete="off"
        />
        <button
          type="button"
          className={styles.dangerButton}
          onClick={handleDelete}
          disabled={isPending || typedSlug.trim() !== workspaceSlug}
        >
          {messages.deleteButton}
        </button>
      </section>
    </main>
  );
}
