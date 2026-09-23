"use client";

import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import styles from "./Sidebar.module.css";

interface NavEntry {
  key: keyof Messages["nav"];
  icon: IconName;
  segment: string;
}

const mainNav: NavEntry[] = [
  { key: "today", icon: "today", segment: "today" },
  { key: "calendar", icon: "calendar", segment: "calendar" },
  { key: "inbox", icon: "inbox", segment: "inbox" },
  { key: "clients", icon: "clients", segment: "clients" },
  { key: "work", icon: "work", segment: "work" },
  { key: "finance", icon: "finance", segment: "finance" },
  { key: "analytics", icon: "analytics", segment: "analytics" },
  { key: "assistant", icon: "assistant", segment: "assistant" },
];

export function Sidebar({
  workspaceSlug,
  messages,
  appName,
}: {
  workspaceSlug: string;
  messages: Messages["nav"];
  appName: string;
}) {
  const pathname = usePathname();
  const base = `/${workspaceSlug}`;

  function isActive(segment: string) {
    return pathname === `${base}/${segment}` || pathname?.startsWith(`${base}/${segment}/`);
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.mark} />
        {appName}
      </div>

      <nav className={styles.nav}>
        {mainNav.map((item) => (
          <a
            key={item.segment}
            href={`${base}/${item.segment}`}
            className={`${styles.navItem} ${isActive(item.segment) ? styles.navItemActive : ""}`}
          >
            <span className={styles.navIcon}>
              <Icon name={item.icon} size={18} />
            </span>
            {messages[item.key]}
          </a>
        ))}
      </nav>

      <div className={styles.spacer} />

      <div className={styles.footNav}>
        <a
          href={`${base}/settings`}
          className={`${styles.navItem} ${isActive("settings") ? styles.navItemActive : ""}`}
        >
          <span className={styles.navIcon}>
            <Icon name="settings" size={18} />
          </span>
          {messages.settings}
        </a>
      </div>
    </aside>
  );
}
