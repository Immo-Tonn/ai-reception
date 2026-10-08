"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Icon } from "@/components/ui";
import styles from "./scheduling.module.css";

/**
 * Header of every scheduling settings page: Back (in-page discard confirm when `dirty`),
 * title, and which business is being edited. `onBack` overrides the destination (e.g. back to a list).
 */
export function SettingsHeader({
  workspaceSlug,
  title,
  subtitle,
  businessLabel,
  businessName,
  backLabel,
  dirty,
  onBack,
  discard,
}: {
  workspaceSlug: string;
  title: string;
  subtitle?: string;
  businessLabel: string;
  businessName: string;
  backLabel: string;
  dirty: boolean;
  onBack?: () => void;
  discard: { discardTitle: string; discardText: string; discard: string; keepEditing: string };
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  const go = () => {
    setConfirming(false);
    if (onBack) onBack();
    else router.push(`/${workspaceSlug}/settings`);
  };

  return (
    <>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} aria-label={backLabel} onClick={() => (dirty ? setConfirming(true) : go())}>
          <Icon name="chevronRight" size={18} style={{ transform: "rotate(180deg)" }} />
        </button>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
      </header>
      <p className={styles.context}>
        <span>{businessLabel}:</span>
        <strong>{businessName}</strong>
      </p>
      {confirming && (
        <div className={styles.confirm} role="alertdialog" aria-label={discard.discardTitle}>
          <p className={styles.confirmTitle}>{discard.discardTitle}</p>
          <p>{discard.discardText}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>{discard.keepEditing}</Button>
            <Button onClick={go}>{discard.discard}</Button>
          </div>
        </div>
      )}
    </>
  );
}
