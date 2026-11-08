import Link from "next/link";
import { Icon } from "@/components/ui";
import styles from "./MobileBackToToday.module.css";

/**
 * Phones reach Clients / Waiting list / Work / Assistant / Settings (and
 * Finance / Analytics when enabled) through "More": the bottom nav only has
 * Today, Calendar, Inbox, More. This is their way home — always to the
 * business's main screen (/today), never router.back() (which could leave
 * the app). Nested pages (a client, a conversation, a settings section) keep
 * their own back link to their parent list instead.
 * Same round arrow as the settings sub-pages, plus the destination as text.
 * Hidden from 900px, where the sidebar is the way around.
 */
export function MobileBackToToday({ workspaceSlug, label }: { workspaceSlug: string; label: string }) {
  return (
    <div className={styles.wrap}>
      <Link href={`/${workspaceSlug}/today`} className={styles.link}>
        <span className={styles.circle} aria-hidden="true">
          <Icon name="chevronRight" size={18} style={{ transform: "rotate(180deg)" }} />
        </span>
        <span className={styles.label}>{label}</span>
      </Link>
    </div>
  );
}
