"use client";

import { useEffect, useState } from "react";
import { Button, Sheet } from "@/components/ui";
import { getClientAction } from "@/server/actions/clients.actions";
import { archiveClientAction, canArchiveClientsAction, restoreClientAction } from "@/server/actions/clientArchive.actions";
import type { ClientRecord } from "@/features/clients/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import formStyles from "../AddClientSheet.module.css";
import styles from "./page.module.css";

/**
 * An archived client is not in the active list (the server returns active
 * clients only), so the card loads it by id. Real workspaces only.
 */
export function useArchivedClient(workspaceSlug: string, clientId: string, enabled: boolean) {
  const key = `${workspaceSlug}/${clientId}`;
  const [result, setResult] = useState<{ key: string; client: ClientRecord | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void getClientAction(workspaceSlug, clientId).then((r) => {
      if (!cancelled) setResult({ key, client: r.ok && r.data?.archivedAt ? r.data : null });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, workspaceSlug, clientId]);
  const done = result?.key === key;
  return { client: enabled && done ? result.client : null, pending: enabled && !done };
}

/**
 * Archive / restore (owner / admin). Reversible: only the archive status changes;
 * appointments (also upcoming ones), invoices and history stay. Not an erasure.
 * An anonymised client cannot be restored (the database refuses it as well).
 */
export function ArchiveClientPanel({
  workspaceSlug,
  client,
  upcomingCount,
  locale,
  messages,
}: {
  workspaceSlug: string;
  client: ClientRecord;
  upcomingCount: number;
  locale: Locale;
  messages: Messages["clients"];
}) {
  const [canArchive, setCanArchive] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const anonymized = Boolean((client as ClientRecord & { anonymizedAt?: string }).anonymizedAt);

  useEffect(() => {
    let cancelled = false;
    void canArchiveClientsAction(workspaceSlug).then((r) => {
      if (!cancelled) setCanArchive(r.ok && r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  async function run(archive: boolean) {
    setWorking(true);
    setFailed(false);
    const r = archive ? await archiveClientAction(workspaceSlug, client.id) : await restoreClientAction(workspaceSlug, client.id);
    if (!r.ok) {
      setWorking(false);
      setFailed(true);
      return;
    }
    // The active list and the card read different sources; reload both.
    window.location.reload();
  }

  const status = client.archivedAt ? (
    <p className={styles.archiveStatus} role="status">
      <span className={styles.tag}>{messages.archivedBadge}</span>{" "}
      {messages.archivedStatus.replace("{date}", formatDate(new Date(client.archivedAt), locale, { dateStyle: "medium" }))}
    </p>
  ) : null;

  if (!canArchive) return status;

  return (
    <>
      {status}
      {client.archivedAt ? (
        anonymized ? (
          <p className={styles.archiveStatus}>{messages.restoreAnonymizedNote}</p>
        ) : (
          <button type="button" className={`${styles.editButton} ${styles.archiveButton}`} onClick={() => void run(false)} disabled={working}>
            {working ? messages.archiveWorking : messages.restoreButton}
          </button>
        )
      ) : (
        <button type="button" className={`${styles.editButton} ${styles.archiveButton}`} onClick={() => setConfirming(true)}>
          {messages.archiveButton}
        </button>
      )}
      {failed && !confirming ? (
        <p role="alert" className={formStyles.error}>
          {messages.archiveError}
        </p>
      ) : null}
      <Sheet open={confirming} onClose={() => setConfirming(false)} title={messages.archiveTitle}>
        <div className={formStyles.form}>
          <p>{messages.archiveIntro}</p>
          <p>{messages.archiveKept}</p>
          <p className={styles.archiveStatus}>{messages.archiveNotErasure}</p>
          {upcomingCount > 0 ? (
            <p role="note" className={formStyles.error}>
              {messages.archiveFutureWarning.replace("{n}", String(upcomingCount))}
            </p>
          ) : null}
          {failed ? (
            <p role="alert" className={formStyles.error}>
              {messages.archiveError}
            </p>
          ) : null}
          <Button fullWidth onClick={() => void run(true)} disabled={working}>
            {working ? messages.archiveWorking : messages.archiveConfirm}
          </Button>
          <Button fullWidth variant="secondary" onClick={() => setConfirming(false)} disabled={working}>
            {messages.archiveCancel}
          </Button>
        </div>
      </Sheet>
    </>
  );
}
