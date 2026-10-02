"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import styles from "./OnlineBooking.module.css";

/**
 * Read-only value with a Copy button. Uses the async Clipboard API and, if
 * it's unavailable or denied (non-secure origin, embedded webview), selects
 * the text so the owner can copy by hand and says so — never a silent no-op.
 */
export function CopyField({
  label,
  hint,
  value,
  multiline = false,
  labels,
}: {
  label: string;
  hint: string;
  value: string;
  multiline?: boolean;
  labels: { copy: string; copied: string; copyFailed: string };
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const fieldRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      fieldRef.current?.select();
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  const id = `copy-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div className={styles.block}>
      <label className={styles.blockLabel} htmlFor={id}>
        {label}
      </label>
      <p className={styles.blockHint}>{hint}</p>
      <div className={styles.copyRow}>
        {multiline ? (
          <textarea
            id={id}
            ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
            className={`${styles.field} ${styles.fieldMultiline}`}
            readOnly
            rows={4}
            value={value}
            onFocus={(e) => e.currentTarget.select()}
          />
        ) : (
          <input
            id={id}
            ref={fieldRef as React.RefObject<HTMLInputElement>}
            className={styles.field}
            readOnly
            value={value}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <Button variant="secondary" size="sm" className={styles.copyButton} onClick={handleCopy}>
          {state === "copied" ? labels.copied : labels.copy}
        </Button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {state === "copied" ? labels.copied : state === "failed" ? labels.copyFailed : ""}
      </p>
    </div>
  );
}
