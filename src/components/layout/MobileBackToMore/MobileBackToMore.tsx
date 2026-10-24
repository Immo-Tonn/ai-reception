import { BackLink } from "@/components/ui/BackLink/BackLink";
import styles from "./MobileBackToMore.module.css";

/**
 * Phones reach Clients / Waiting list / Work / Assistant through "More"
 * (the bottom nav only has Today, Calendar, Inbox, More). This gives those
 * screens a visible way back. Hidden from 900px, where the sidebar shows.
 */
export function MobileBackToMore({ workspaceSlug, label }: { workspaceSlug: string; label: string }) {
  return (
    <div className={styles.wrap}>
      <BackLink href={`/${workspaceSlug}/more`} label={label} />
    </div>
  );
}
