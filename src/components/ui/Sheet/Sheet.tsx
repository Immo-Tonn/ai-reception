"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../Icon/Icon";
import styles from "./Sheet.module.css";

/**
 * Mobile-first bottom sheet: full-width sheet sliding from the bottom on
 * phones, centered modal on tablet/desktop (§84 — appointment drawer/modal
 * builds on this same primitive later).
 *
 * Rendered through a portal straight into `document.body` instead of
 * inline where the component is used. `position: fixed` is only ever
 * fixed to the viewport if no ancestor establishes its own containing
 * block (a `transform`, `filter`, `contain`, etc. anywhere between this
 * component and `<body>`) — a portal makes that guarantee unconditional,
 * so the sheet can never end up laid out inside a page's scroll/flow
 * (e.g. rendering "inside" the Calendar list instead of floating above
 * it) no matter what a future ancestor component does.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={title}>
        <div className={styles.grabber} />
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
