"use client";

import { useEffect } from "react";
import { Icon } from "../Icon/Icon";
import styles from "./SaveStatus.module.css";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface SaveStatusProps {
  state: SaveState;
  labels: { unsaved: string; saving: string; saved: string };
  /** Shown while state is "error" and stays until the next edit or save. */
  error?: string | null;
  /** Called once the "saved" confirmation has been visible long enough; the caller resets to "idle". */
  onSavedExpire?: () => void;
  /** How long the confirmation stays, in ms. */
  savedMs?: number;
}

/**
 * One status line for every save flow: unsaved changes -> saving -> saved (auto-hides) / error.
 * Styled as a status chip (icon + text), never like an input field. Announced politely to
 * screen readers; errors use role="alert".
 */
export function SaveStatus({ state, labels, error, onSavedExpire, savedMs = 3500 }: SaveStatusProps) {
  useEffect(() => {
    if (state !== "saved" || !onSavedExpire) return;
    const timer = window.setTimeout(onSavedExpire, savedMs);
    return () => window.clearTimeout(timer);
  }, [state, onSavedExpire, savedMs]);

  if (state === "error" && error) {
    return (
      <p role="alert" className={`${styles.chip} ${styles.error}`}>
        <Icon name="alert" size={16} />
        <span>{error}</span>
      </p>
    );
  }
  if (state === "saving") {
    return (
      <p role="status" aria-live="polite" className={`${styles.chip} ${styles.saving}`}>
        <span className={styles.spinner} aria-hidden="true" />
        <span>{labels.saving}</span>
      </p>
    );
  }
  if (state === "saved") {
    return (
      <p role="status" aria-live="polite" className={`${styles.chip} ${styles.saved}`}>
        <Icon name="check" size={16} strokeWidth={2.4} />
        <span>{labels.saved}</span>
      </p>
    );
  }
  if (state === "dirty") {
    return (
      <p role="status" aria-live="polite" className={`${styles.chip} ${styles.dirty}`}>
        <span className={styles.dot} aria-hidden="true" />
        <span>{labels.unsaved}</span>
      </p>
    );
  }
  return null;
}
