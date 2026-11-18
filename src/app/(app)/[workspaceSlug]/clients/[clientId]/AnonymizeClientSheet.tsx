"use client";

import { useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import { anonymizeClientAction } from "@/server/actions/clients.actions";
import type { Messages } from "@/lib/i18n";
import formStyles from "../AddClientSheet.module.css";
import styles from "./AnonymizeClientSheet.module.css";

/**
 * GDPR erasure of one client (owner only; the server and the database check it
 * again). Lists what is deleted, what is replaced by "Gelöschter Kunde" and what
 * is kept and why, then asks for the client's name before the irreversible step.
 */
export function AnonymizeClientSheet({
  workspaceSlug,
  clientId,
  clientName,
  open,
  onClose,
  onDone,
  messages,
}: {
  workspaceSlug: string;
  clientId: string;
  clientName: string;
  open: boolean;
  onClose: () => void;
  onDone: () => Promise<unknown> | void;
  messages: Messages["clients"];
}) {
  const [typed, setTyped] = useState("");
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmed = typed.trim() === clientName.trim() && clientName.trim() !== "";

  async function handleConfirm() {
    if (!confirmed || working) return;
    setWorking(true);
    setFailed(false);
    const result = await anonymizeClientAction(workspaceSlug, clientId);
    setWorking(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    await onDone();
    onClose();
  }

  const section = (title: string, items: readonly string[]) => (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );

  return (
    <Sheet open={open} onClose={onClose} title={messages.anonymizeTitle}>
      <div className={formStyles.form}>
        {section(messages.anonymizeRemovedTitle, messages.anonymizeRemoved)}
        {section(messages.anonymizePseudoTitle, messages.anonymizePseudo)}
        {section(messages.anonymizeKeptTitle, messages.anonymizeKept)}
        <p className={styles.note}>{messages.anonymizeAccountNote}</p>
        <p className={styles.warning} role="note">{messages.anonymizeIrreversible}</p>
        <Input
          label={messages.anonymizeConfirmLabel.replace("{name}", clientName)}
          value={typed}
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
        />
        {failed ? (
          <p role="alert" className={formStyles.error}>
            {messages.anonymizeError}
          </p>
        ) : null}
        <Button fullWidth variant="destructive" onClick={handleConfirm} disabled={!confirmed || working}>
          {working ? messages.anonymizeWorking : messages.anonymizeSubmit}
        </Button>
      </div>
    </Sheet>
  );
}
