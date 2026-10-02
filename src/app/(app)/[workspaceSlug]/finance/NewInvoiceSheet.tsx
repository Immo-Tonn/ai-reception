"use client";

import { useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import { localIsoDate } from "@/lib/date/localIsoDate";
import type { FinancialBucket, Visibility } from "@/features/appointments/types";
import {
  bucketOptions,
  visibilityOptions,
} from "@/features/appointments/selectableOptions";
import type { Invoice } from "@/features/finance/types";
import type { Messages } from "@/lib/i18n";
import styles from "./NewInvoiceSheet.module.css";

export function NewInvoiceSheet({
  open,
  onClose,
  onSave,
  messages,
  appointmentMessages,
  initialValue,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (invoice: Invoice) => void;
  messages: Messages["finance"];
  appointmentMessages: Messages["appointment"];
  /** Editing an existing invoice instead of creating one — pass a
   * `key={invoice.id}` at the call site so each invoice gets its own
   * fresh form state (same pattern as AppointmentSheet). */
  initialValue?: Invoice | null;
}) {
  const isEditing = Boolean(initialValue);
  // Normal/Private and Main/Private in the form; a legacy ownerOnly/custom
  // value on an invoice being edited still shows (see selectableOptions.ts).
  const visibilityLabel: Record<Visibility, string> = {
    normal: appointmentMessages.visibilityNormal,
    private: appointmentMessages.visibilityPrivate,
    ownerOnly: appointmentMessages.visibilityOwnerOnly,
    custom: appointmentMessages.visibilityCustom,
  };
  const bucketLabel: Record<FinancialBucket, string> = {
    main: appointmentMessages.bucketMain,
    private: appointmentMessages.bucketPrivate,
    custom: appointmentMessages.bucketCustom,
  };
  const [client, setClient] = useState(initialValue?.client ?? "");
  const [amount, setAmount] = useState(initialValue?.amount ?? 0);
  const [bucket, setBucket] = useState<FinancialBucket>(initialValue?.bucket ?? "main");
  const [visibility, setVisibility] = useState<Visibility>(initialValue?.visibility ?? "normal");

  function handleSave() {
    if (!client.trim()) return;
    if (isEditing && initialValue) {
      onSave({ ...initialValue, client, amount, bucket, visibility });
      onClose();
      return;
    }
    onSave({
      id: String(Date.now()),
      number: `#${Math.floor(1000 + Math.random() * 9000)}`,
      client,
      amount,
      currency: "EUR",
      status: "unpaid",
      bucket,
      visibility,
      date: localIsoDate(new Date()),
    });
    setClient("");
    setAmount(0);
    setVisibility("normal");
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={isEditing ? messages.editInvoice : messages.newInvoice}>
      <div className={styles.form}>
        <Input
          label={messages.newInvoiceClientLabel}
          value={client}
          onChange={(event) => setClient(event.target.value)}
        />
        <Input
          label={messages.newInvoiceAmountLabel}
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(Number(event.target.value))}
        />
        <div className={styles.field}>
          <label className={styles.label}>{appointmentMessages.financialBucketLabel}</label>
          <select
            className={styles.select}
            value={bucket}
            onChange={(event) => setBucket(event.target.value as FinancialBucket)}
          >
            {bucketOptions(initialValue?.bucket).map((value) => (
              <option key={value} value={value}>
                {bucketLabel[value]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>{appointmentMessages.visibilityLabel}</label>
          <select
            className={styles.select}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as Visibility)}
          >
            {visibilityOptions(initialValue?.visibility).map((value) => (
              <option key={value} value={value}>
                {visibilityLabel[value]}
              </option>
            ))}
          </select>
        </div>
        <span className={styles.separationNote}>{appointmentMessages.separationNote}</span>
        <Button fullWidth onClick={handleSave}>
          {isEditing ? messages.saveInvoice : messages.newInvoiceSave}
        </Button>
      </div>
    </Sheet>
  );
}
