import Link from "next/link";
import { Icon } from "../Icon/Icon";
import styles from "./BackLink.module.css";

/**
 * The single contextual "go back" affordance for secondary/flow screens
 * (Business/Client intros, signup/login, onboarding, booking steps) —
 * never added to top-level app screens (Today/Calendar/Clients/…) where
 * the sidebar/bottom nav is already the way around. `label` says WHERE
 * it goes, not just "Back" — the destination is part of the label by
 * design (e.g. "ServiceOS", "ServiceOS for business"), so the user never
 * has to guess.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={styles.backLink} aria-label={label}>
      <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
      <span>{label}</span>
    </Link>
  );
}
