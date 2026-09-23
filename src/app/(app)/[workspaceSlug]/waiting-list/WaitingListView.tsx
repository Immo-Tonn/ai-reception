"use client";

import { useState } from "react";
import { Button, Icon } from "@/components/ui";
import { useWaitingList } from "@/features/waitingList/useWaitingList";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import { AddWaitingListSheet } from "./AddWaitingListSheet";
import styles from "./page.module.css";

export function WaitingListView({
  workspaceSlug,
  locale,
  messages,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["waitingList"];
}) {
  const { items, create } = useWaitingList(workspaceSlug);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
        <Button className={styles.newButton} onClick={() => setSheetOpen(true)}>
          {messages.addEntry}
        </Button>
      </header>

      {items.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>{messages.empty}</span>
          <span className={styles.emptyDescription}>{messages.emptyDescription}</span>
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((entry) => (
            <div key={entry.id} className={styles.row}>
              <span className={styles.rowTitle}>{entry.client}</span>
              <span className={styles.rowMeta}>
                {entry.service}
                {entry.preferredStaff ? ` · ${entry.preferredStaff}` : ""} ·{" "}
                {formatDate(new Date(entry.earliestDate), locale, { dateStyle: "medium" })}–
                {formatDate(new Date(entry.latestDate), locale, { dateStyle: "medium" })}
              </span>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className={styles.fab}
        onClick={() => setSheetOpen(true)}
        aria-label={messages.addEntry}
      >
        <Icon name="plus" size={24} />
      </button>

      <AddWaitingListSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSave={create}
        messages={messages}
        workspaceSlug={workspaceSlug}
      />
    </main>
  );
}
