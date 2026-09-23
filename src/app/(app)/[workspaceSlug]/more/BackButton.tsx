"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import styles from "./page.module.css";

/**
 * Real back navigation (router.back()), not an "X" — /more is a normal
 * page in the stack, not a modal, so it should support the browser/OS
 * back gesture too, which this doesn't interfere with (§ mobile nav
 * follow-up).
 */
export function BackButton({ fallbackHref, label }: { fallbackHref: string; label: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={styles.backButton}
      aria-label={label}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallbackHref);
      }}
    >
      <Icon name="chevronRight" size={18} style={{ transform: "rotate(180deg)" }} />
    </button>
  );
}
