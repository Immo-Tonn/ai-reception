import Link from "next/link";
import { Icon } from "@/components/ui";
import styles from "./MobileBackToMore.module.css";

/**
 * Phones reach Clients / Waiting list / Work / Assistant / Settings (and
 * Finance / Analytics when enabled) through "More": the bottom nav only has
 * Today, Calendar, Inbox, More. This is their way back — always to the
 * logical parent (/more), never router.back() (which could leave the app).
 * Same round arrow as the settings sub-pages, plus the destination as text.
 * Hidden from 900px, where the sidebar is the way around.
 */
export function MobileBackToMore({ workspaceSlug, label }: { workspaceSlug: string; label: string }) {
  return (
    <div className={styles.wrap}>
      <Link href={`/${workspaceSlug}/more`} className={styles.link}>
        <span className={styles.circle} aria-hidden="true">
          <Icon name="chevronRight" size={18} style={{ transform: "rotate(180deg)" }} />
        </span>
        <span className={styles.label}>{label}</span>
      </Link>
    </div>
  );
}
