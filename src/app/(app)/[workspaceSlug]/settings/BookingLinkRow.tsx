"use client";

import { useState } from "react";
import styles from "./page.module.css";

export function BookingLinkRow({
  slug,
  label,
  description,
  copyLabel,
  copiedLabel,
}: {
  slug: string;
  label: string;
  description: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const url = `${window.location.origin}/book/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(copyLabel, url);
    }
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowBody}>
        <p className={styles.rowLabel}>{label}</p>
        <p className={styles.rowDescription}>{description}</p>
        <p className={styles.rowDescription}>/book/{slug}</p>
      </div>
      <button type="button" className={styles.linkButton} onClick={handleCopy}>
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  );
}
