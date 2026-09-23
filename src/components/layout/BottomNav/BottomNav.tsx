"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui";
import type { Messages } from "@/lib/i18n";
import { QuickCreateSheet } from "./QuickCreateSheet";
import styles from "./BottomNav.module.css";

interface NavEntry {
  key: keyof Messages["nav"];
  icon: IconName;
  segment: string;
}

const items: NavEntry[] = [
  { key: "today", icon: "today", segment: "today" },
  { key: "calendar", icon: "calendar", segment: "calendar" },
  { key: "inbox", icon: "inbox", segment: "inbox" },
  { key: "more", icon: "more", segment: "more" },
];

export function BottomNav({
  workspaceSlug,
  nav,
  quickCreate,
}: {
  workspaceSlug: string;
  nav: Messages["nav"];
  quickCreate: Messages["quickCreate"];
}) {
  const pathname = usePathname();
  const base = `/${workspaceSlug}`;
  const [createOpen, setCreateOpen] = useState(false);

  function isActive(segment: string) {
    return pathname === `${base}/${segment}` || pathname?.startsWith(`${base}/${segment}/`);
  }

  const [today, calendar, inbox, more] = items;

  return (
    <>
      <nav className={styles.nav} aria-label={nav.today}>
        <NavLink base={base} item={today} active={isActive(today.segment)} label={nav[today.key]} />
        <NavLink
          base={base}
          item={calendar}
          active={isActive(calendar.segment)}
          label={nav[calendar.key]}
        />

        <button
          type="button"
          className={styles.createButton}
          onClick={() => setCreateOpen(true)}
          aria-label={nav.create}
        >
          <span className={styles.createButtonMark}>
            <Icon name="plus" size={22} strokeWidth={1.8} />
          </span>
        </button>

        <NavLink base={base} item={inbox} active={isActive(inbox.segment)} label={nav[inbox.key]} />
        <NavLink base={base} item={more} active={isActive(more.segment)} label={nav[more.key]} />
      </nav>

      <QuickCreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        workspaceSlug={workspaceSlug}
        messages={quickCreate}
      />
    </>
  );
}

function NavLink({
  base,
  item,
  active,
  label,
}: {
  base: string;
  item: NavEntry;
  active: boolean;
  label: string;
}) {
  return (
    <a href={`${base}/${item.segment}`} className={`${styles.item} ${active ? styles.itemActive : ""}`}>
      <Icon name={item.icon} size={22} />
      <span className={styles.itemLabel}>{label}</span>
    </a>
  );
}
