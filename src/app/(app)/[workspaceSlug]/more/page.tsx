import { Icon, type IconName } from "@/components/ui";
import { getMessages, type Messages } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/i18n/next";
import { BackButton } from "./BackButton";
import styles from "./page.module.css";

const items: { key: keyof Messages["nav"]; icon: IconName; segment: string }[] = [
  { key: "clients", icon: "clients", segment: "clients" },
  { key: "work", icon: "work", segment: "work" },
  { key: "finance", icon: "finance", segment: "finance" },
  { key: "waitingList", icon: "clients", segment: "waiting-list" },
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
  const { nav, more, common } = getMessages(locale);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <BackButton fallbackHref={`/${workspaceSlug}/today`} label={common.back} />
        <h1 className={styles.title}>{more.title}</h1>
      </header>
      <div className={styles.list}>
        {items.map((item) => (
          <a key={item.segment} href={`/${workspaceSlug}/${item.segment}`} className={styles.item}>
            <span className={styles.itemIcon}>
              <Icon name={item.icon} size={18} />
            </span>
            <span className={styles.itemLabel}>{nav[item.key]}</span>
            <span className={styles.itemChevron}>
              <Icon name="chevronRight" size={18} />
            </span>
          </a>
        ))}
      </div>
    </main>
  );
}
