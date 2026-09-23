"use client";

import { useEffect, useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import type { FinancialBucket, Visibility } from "@/features/appointments/types";
import type { Messages } from "@/lib/i18n";
import styles from "./page.module.css";

export type WorkKind = "lead" | "quote" | "job" | "project";

export interface WorkItemDraft {
  clientName: string;
  title: string;
  notes: string;
  amount: number;
  visibility: Visibility;
  financialBucket: FinancialBucket;
}

export function WorkItemSheet({
  open,
  onClose,
  onSave,
  kind,
  messages,
  appointmentMessages,
  prefillClient,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (draft: WorkItemDraft) => void;
  kind: WorkKind;
  messages: Messages["work"];
  appointmentMessages: Messages["appointment"];
  prefillClient?: string;
}) {
  const [clientName, setClientName] = useState(prefillClient ?? "");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("normal");
  const [financialBucket, setFinancialBucket] = useState<FinancialBucket>("main");

  useEffect(() => {
    if (open) setClientName(prefillClient ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function reset() {
    setClientName("");
    setTitle("");
    setAmount(0);
    setNotes("");
    setVisibility("normal");
    setFinancialBucket("main");
  }

  function handleSave() {
    if (!clientName.trim() || !title.trim()) return;
    onSave({ clientName: clientName.trim(), title: title.trim(), notes, amount, visibility, financialBucket });
    reset();
    onClose();
  }

  const sheetTitle =
    kind === "lead"
      ? messages.newLead
      : kind === "quote"
        ? messages.newQuote
        : kind === "job"
          ? messages.newJob
          : messages.newProject;

  const showAmount = kind === "quote" || kind === "job";

  return (
    <Sheet open={open} onClose={onClose} title={sheetTitle}>
      <div className={styles.form}>
        <Input
          label={messages.clientLabel}
          placeholder={messages.clientPlaceholder}
          value={clientName}
          onChange={(event) => setClientName(event.target.value)}
        />
        <Input
          label={messages.titleLabel}
          placeholder={messages.titlePlaceholder}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {showAmount && (
          <Input
            label={messages.amountLabel}
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(Number(event.target.value))}
          />
        )}

        <div className={styles.field}>
          <label className={styles.label}>{messages.notesLabel}</label>
          <textarea
            className={styles.textarea}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </div>

        <div className={styles.field}>
          <span className={styles.label}>{messages.visibilityLabel}</span>
          <div className={styles.optionRow}>
            {(
              [
                ["normal", appointmentMessages.visibilityNormal],
                ["private", appointmentMessages.visibilityPrivate],
                ["ownerOnly", appointmentMessages.visibilityOwnerOnly],
                ["custom", appointmentMessages.visibilityCustom],
              ] as [Visibility, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`${styles.option} ${visibility === value ? styles.optionSelected : ""}`}
                onClick={() => setVisibility(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>{messages.financialBucketLabel}</span>
          <div className={styles.optionRow}>
            {(
              [
                ["main", appointmentMessages.bucketMain],
                ["private", appointmentMessages.bucketPrivate],
                ["custom", appointmentMessages.bucketCustom],
              ] as [FinancialBucket, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`${styles.option} ${financialBucket === value ? styles.optionSelected : ""}`}
                onClick={() => setFinancialBucket(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <Button fullWidth onClick={handleSave}>
          {messages.save}
        </Button>
      </div>
    </Sheet>
  );
}
