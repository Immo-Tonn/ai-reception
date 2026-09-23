"use client";

import { Sheet } from "@/components/ui";
import type { AuditLogEntry } from "@/features/auditLog/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDateTime } from "@/lib/i18n/format";
import styles from "./HistorySheet.module.css";

export function HistorySheet({
  open,
  onClose,
  entries,
  locale,
  messages,
}: {
  open: boolean;
  onClose: () => void;
  entries: AuditLogEntry[];
  locale: Locale;
  messages: Messages["auditLog"];
}) {
  return (
    <Sheet open={open} onClose={onClose} title={messages.title}>
      {entries.length === 0 ? (
        <div className={styles.empty}>{messages.empty}</div>
      ) : (
        <div className={styles.list}>
          {entries.map((entry) => (
            <div key={entry.id} className={styles.row}>
              <div className={styles.rowSummary}>{entry.summary}</div>
              <div className={styles.rowMeta}>
                {formatDateTime(new Date(entry.timestamp), locale)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}
