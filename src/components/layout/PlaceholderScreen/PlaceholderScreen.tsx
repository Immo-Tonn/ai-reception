import { Icon, type IconName } from "@/components/ui";
import styles from "./PlaceholderScreen.module.css";

/**
 * Shared shell for screens not yet built in the product order (§ roadmap:
 * Landing → Login/Signup → Onboarding → Today → Calendar → Appointment →
 * Clients → Finance → Assistant). Every nav item still routes to a real,
 * working page instead of a 404 — this is an honest "not yet", not a fake
 * feature.
 */
export function PlaceholderScreen({
  icon,
  pageTitle,
  emptyTitle,
  emptyDescription,
  backLabel,
  backHref,
}: {
  icon: IconName;
  pageTitle: string;
  emptyTitle: string;
  emptyDescription: string;
  backLabel: string;
  backHref: string;
}) {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{pageTitle}</h1>
      <div className={styles.empty}>
        <span className={styles.emptyIcon}>
          <Icon name={icon} size={22} />
        </span>
        <span className={styles.emptyTitle}>{emptyTitle}</span>
        <span className={styles.emptyDescription}>{emptyDescription}</span>
        <a className={styles.backLink} href={backHref}>
          <Icon name="chevronRight" size={16} style={{ transform: "rotate(180deg)" }} />
          {backLabel}
        </a>
      </div>
    </main>
  );
}
