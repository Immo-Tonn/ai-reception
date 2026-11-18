"use client";

import { useEffect, useState } from "react";
import { canRestoreClientAction } from "@/server/actions/clientArchive.actions";
import type { Messages } from "@/lib/i18n";
import styles from "./QuickActionsSheet.module.css";

/**
 * "Client in the archive" inside an appointment. Everyone who sees the mark may
 * read the client (the server sets it through RLS); the restore controls appear
 * only for owner / admin and never for an anonymised client. The server and the
 * database check all of this again.
 */
export function ArchivedClientNotice({
  workspaceSlug,
  clientId,
  messages,
  busy,
  onRestore,
}: {
  workspaceSlug: string;
  clientId: string;
  messages: Messages["quickActions"];
  busy: boolean;
  onRestore: () => void;
}) {
  const [canRestore, setCanRestore] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void canRestoreClientAction(workspaceSlug, clientId).then((r) => {
      if (!cancelled) setCanRestore(r.ok && r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, clientId]);

  return (
    <div className={styles.archiveNotice}>
      <span className={styles.archiveBadge}>{messages.clientArchivedNotice}</span>
      {canRestore ? (
        <button type="button" className={styles.archiveRestore} onClick={onRestore} disabled={busy}>
          {messages.restoreClient}
        </button>
      ) : null}
    </div>
  );
}
