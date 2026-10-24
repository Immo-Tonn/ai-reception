import Link from "next/link";
import { Icon, type IconName } from "@/components/ui";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import { getMessages, type Messages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { getFeatureFlags } from "@/lib/config/features";
import styles from "./page.module.css";

const items: { key: keyof Messages["nav"]; icon: IconName; segment: string }[] = [
  { key: "clients", icon: "clients", segment: "clients" },
  { key: "work", icon: "work", segment: "work" },
  { key: "finance", icon: "finance", segment: "finance" },
  { key: "waitingList", icon: "history", segment: "waiting-list" },
  { key: "analytics", icon: "analytics", segment: "analytics" },
  { key: "assistant", icon: "assistant", segment: "assistant" },
  { key: "settings", icon: "settings", segment: "settings" },
];

export default async function MorePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const locale = await getRequestLocale();
  const { nav, more } = getMessages(locale);
  const workspace = getWorkspaceConfig(workspaceSlug);
  const features = getFeatureFlags();
  const visibleItems = items.filter(
    (item) =>
      (item.key !== "work" || workspace.workEnabled !== false) &&
      (item.key !== "finance" || features.finance) &&
      (item.key !== "analytics" || features.analytics),
  );

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{more.title}</h1>
      </header>
      <div className={styles.list}>
        {visibleItems.map((item) => (
          <Link key={item.segment} href={`/${workspaceSlug}/${item.segment}`} className={styles.item}>
            <span className={styles.itemIcon}>
              <Icon name={item.icon} size={18} />
            </span>
            <span className={styles.itemLabel}>
              {item.key === "work" ? (workspace.workLabel?.[locale] ?? nav.work) : nav[item.key]}
            </span>
            <span className={styles.itemChevron}>
              <Icon name="chevronRight" size={18} />
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}
