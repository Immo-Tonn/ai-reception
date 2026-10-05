"use client";

import { useCallback, useState } from "react";
import { Button, Icon, SaveStatus, type SaveState } from "@/components/ui";
import { useWaitingList } from "@/features/waitingList/useWaitingList";
import { bookingLinkForEntry } from "@/features/waitingList/matching";
import { isActiveWaitingStatus, type WaitingListEntry, type WaitingListStatus } from "@/features/waitingList/types";
import { useWorkspaceToday } from "@/features/workspace/WorkspaceCatalog";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import { AddWaitingListSheet } from "./AddWaitingListSheet";
import styles from "./page.module.css";

function errorText(code: unknown, messages: Messages["waitingList"]): string {
  return code === "forbidden" ? messages.forbiddenError : messages.saveError;
}

export function WaitingListView({
  workspaceSlug,
  locale,
  messages,
  youLabel,
  saveLabels,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["waitingList"];
  youLabel: string;
  saveLabels: { unsaved: string; saving: string; saved: string };
}) {
  const { items, loaded, error, refresh, create, update } = useWaitingList(workspaceSlug);
  const today = useWorkspaceToday(workspaceSlug);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<WaitingListEntry | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const expire = useCallback(() => setSaveState("idle"), []);
  const visible = items.filter((entry) => showHistory || isActiveWaitingStatus(entry.status));
  const hasHistory = items.some((entry) => !isActiveWaitingStatus(entry.status));

  const statusLabel: Record<WaitingListStatus, string> = {
    waiting: messages.statusWaiting,
    contacted: messages.statusContacted,
    booked: messages.statusBooked,
    closed: messages.statusClosed,
  };

  function openAdd() {
    setEditing(null);
    setSheetOpen(true);
  }

  async function handleSave(entry: WaitingListEntry) {
    setSaveState("saving");
    setSaveError(null);
    try {
      if (editing) await update(editing.id, entry);
      else await create(entry);
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setSaveError(errorText(e instanceof Error && "code" in e ? (e as { code: unknown }).code : null, messages));
      throw e;
    }
  }

  async function setStatus(entry: WaitingListEntry, status: WaitingListStatus) {
    setBusyId(entry.id);
    setSaveState("saving");
    setSaveError(null);
    try {
      await update(entry.id, { status });
      setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setSaveError(errorText(e instanceof Error && "code" in e ? (e as { code: unknown }).code : null, messages));
    } finally {
      setBusyId(null);
    }
  }

  const day = (iso: string) => formatDate(new Date(`${iso}T12:00:00`), locale, { dateStyle: "medium" });

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
        <Button className={styles.newButton} onClick={openAdd}>
          {messages.addEntry}
        </Button>
      </header>

      <SaveStatus state={saveState} labels={saveLabels} error={saveError} onSavedExpire={expire} />

      {!loaded ? (
        <p role="status" className={styles.rowMeta}>{messages.loading}</p>
      ) : error ? (
        <div className={styles.errorBox} role="alert">
          <span>{error === "forbidden" ? messages.forbiddenError : messages.loadError}</span>
          <button type="button" className={styles.actionButton} onClick={() => void refresh()}>{messages.retry}</button>
        </div>
      ) : (
        <>
          {hasHistory ? (
            <div className={styles.toolbar}>
              <label className={styles.toggle}>
                <input suppressHydrationWarning type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />
                {messages.showHistory}
              </label>
            </div>
          ) : null}

          {visible.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>{messages.empty}</span>
              <span className={styles.emptyDescription}>{messages.emptyDescription}</span>
            </div>
          ) : (
            <div className={styles.list}>
              {visible.map((entry) => {
                const status = entry.status ?? "waiting";
                const active = isActiveWaitingStatus(status);
                const busy = busyId === entry.id;
                return (
                  <div key={entry.id} className={styles.row}>
                    <div className={styles.rowTop}>
                      <span className={styles.rowTitle}>{entry.client}</span>
                      <span className={`${styles.status} ${status === "waiting" ? styles.statusWaiting : status === "contacted" ? styles.statusContacted : ""}`}>
                        {statusLabel[status]}
                      </span>
                    </div>
                    <span className={styles.rowMeta}>
                      {entry.service}
                      {entry.preferredStaff ? ` · ${entry.preferredStaff}` : ""} · {day(entry.earliestDate)}–{day(entry.latestDate)}
                      {entry.preferredTimeStart || entry.preferredTimeEnd
                        ? ` · ${entry.preferredTimeStart ?? ""}–${entry.preferredTimeEnd ?? ""}`
                        : ""}
                    </span>
                    {entry.notes ? <span className={styles.rowNotes}>{entry.notes}</span> : null}
                    <div className={styles.actions}>
                      {active ? (
                        <a className={`${styles.actionButton} ${styles.actionPrimary}`} href={bookingLinkForEntry(workspaceSlug, entry, today)}>
                          {messages.bookNow}
                        </a>
                      ) : null}
                      {status === "waiting" ? (
                        <button type="button" className={styles.actionButton} disabled={busy} onClick={() => void setStatus(entry, "contacted")}>
                          {messages.markContacted}
                        </button>
                      ) : null}
                      {active ? (
                        <button type="button" className={styles.actionButton} disabled={busy} onClick={() => void setStatus(entry, "booked")}>
                          {messages.statusBooked}
                        </button>
                      ) : null}
                      {active ? (
                        <button type="button" className={styles.actionButton} disabled={busy} onClick={() => void setStatus(entry, "closed")}>
                          {messages.closeEntry}
                        </button>
                      ) : (
                        <button type="button" className={styles.actionButton} disabled={busy} onClick={() => void setStatus(entry, "waiting")}>
                          {messages.reopenEntry}
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.actionButton}
                        disabled={busy}
                        onClick={() => {
                          setEditing(entry);
                          setSheetOpen(true);
                        }}
                      >
                        {messages.editEntry}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <button type="button" className={styles.fab} onClick={openAdd} aria-label={messages.addEntry}>
        <Icon name="plus" size={24} />
      </button>

      <AddWaitingListSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSave={handleSave}
        messages={messages}
        workspaceSlug={workspaceSlug}
        locale={locale}
        youLabel={youLabel}
        initial={editing}
      />
    </main>
  );
}
