"use client";

import { useState } from "react";
import { Button, Input, SaveStatus, Sheet } from "@/components/ui";
import type {
  FinancialBucket,
  Visibility,
} from "@/features/appointments/types";
import type {
  Job,
  Lead,
  Project,
  Quote,
  QuoteItem,
  WorkKind,
} from "@/features/work/types";
import type { Messages } from "@/lib/i18n";
import styles from "./page.module.css";

export type { WorkKind };

export interface WorkItemDraft {
  clientId: string | null;
  clientName: string;
  title: string;
  notes: string;
  amount: number;
  /** Undefined while editing: visibility and financial bucket are then left exactly as stored. */
  visibility?: Visibility;
  financialBucket?: FinancialBucket;
  source: string;
  startsOn: string | null;
  dueOn: string | null;
  endsOn: string | null;
  validUntil: string | null;
  staffId: string | null;
  items: QuoteItem[];
}

export type EditableWork = Lead | Quote | Job | Project;

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Rejects when the save fails; the sheet then stays open and shows `errorText`. */
  onSave: (draft: WorkItemDraft) => Promise<void>;
  kind: WorkKind;
  messages: Messages["work"];
  opsMessages: Messages["workOps"];
  appointmentMessages: Messages["appointment"];
  prefillClient?: string;
  /** Real workspace: client picker from real clients, Normal/Private + Main/Private only. */
  real: boolean;
  clients: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  editing?: EditableWork | null;
  errorText?: string | null;
}

export function WorkItemSheet(props: SheetProps) {
  const { open, onClose, kind, messages, opsMessages, editing } = props;
  const title = editing
    ? opsMessages.editTitle
    : kind === "lead"
      ? messages.newLead
      : kind === "quote"
        ? messages.newQuote
        : kind === "job"
          ? messages.newJob
          : messages.newProject;
  // The form is mounted only while the sheet is open, so every opening starts from fresh values
  // (blank for a new item, the stored values for an edit).
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open ? <WorkItemForm key={editing?.id ?? "new"} {...props} /> : null}
    </Sheet>
  );
}

function WorkItemForm({
  onClose,
  onSave,
  kind,
  messages,
  opsMessages,
  appointmentMessages,
  prefillClient,
  real,
  clients,
  staff,
  editing,
  errorText,
}: SheetProps) {
  const e = editing ?? null;
  const [clientId, setClientId] = useState(e?.clientId ?? "");
  const [clientName, setClientName] = useState(
    e ? e.clientName : (prefillClient ?? ""),
  );
  const [title, setTitle] = useState(e?.title ?? "");
  const [amount, setAmount] = useState(
    e && "amount" in e ? String(e.amount) : "0",
  );
  const [notes, setNotes] = useState(e?.notes ?? "");
  const [source, setSource] = useState(
    e && "source" in e ? (e.source ?? "") : "",
  );
  const [startsOn, setStartsOn] = useState(
    e && "startsOn" in e ? (e.startsOn ?? "") : "",
  );
  const [dueOn, setDueOn] = useState(e && "dueOn" in e ? (e.dueOn ?? "") : "");
  const [endsOn, setEndsOn] = useState(
    e && "endsOn" in e ? (e.endsOn ?? "") : "",
  );
  const [validUntil, setValidUntil] = useState(
    e && "validUntil" in e ? (e.validUntil ?? "") : "",
  );
  const [staffId, setStaffId] = useState(
    e && "staffId" in e ? (e.staffId ?? "") : "",
  );
  const [items, setItems] = useState<
    { description: string; quantity: string; unitPrice: string }[]
  >(
    e && "items" in e && e.items
      ? e.items.map((i) => ({
          description: i.description,
          quantity: String(i.quantity),
          unitPrice: String(i.unitPrice),
        }))
      : [],
  );
  const [visibility, setVisibility] = useState<Visibility>("normal");
  const [financialBucket, setFinancialBucket] =
    useState<FinancialBucket>("main");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  const toNumber = (v: string) => {
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  };
  const parsedItems: QuoteItem[] = items
    .filter((i) => i.description.trim())
    .map((i) => ({
      description: i.description.trim(),
      quantity: toNumber(i.quantity) || 1,
      unitPrice: toNumber(i.unitPrice),
    }));
  const hasItems = kind === "quote" && parsedItems.length > 0;

  async function handleSave() {
    const pickedClient = clients.find((c) => c.id === clientId);
    const name = pickedClient ? pickedClient.name : clientName.trim();
    if (!title.trim() || !name) return;
    setState("saving");
    try {
      await onSave({
        clientId: real && pickedClient ? pickedClient.id : null,
        clientName: name,
        title: title.trim(),
        notes,
        amount: toNumber(amount),
        ...(editing ? {} : { visibility, financialBucket }),
        source: source.trim(),
        startsOn: startsOn || null,
        dueOn: dueOn || null,
        endsOn: endsOn || null,
        validUntil: validUntil || null,
        staffId: staffId || null,
        items: parsedItems,
      });
      onClose();
    } catch {
      setState("error");
    }
  }

  const visibilityOptions = (
    real
      ? [
          ["normal", appointmentMessages.visibilityNormal],
          ["private", appointmentMessages.visibilityPrivate],
        ]
      : [
          ["normal", appointmentMessages.visibilityNormal],
          ["private", appointmentMessages.visibilityPrivate],
          ["ownerOnly", appointmentMessages.visibilityOwnerOnly],
          ["custom", appointmentMessages.visibilityCustom],
        ]
  ) as [Visibility, string][];
  const bucketOptions = (
    real
      ? [
          ["main", appointmentMessages.bucketMain],
          ["private", appointmentMessages.bucketPrivate],
        ]
      : [
          ["main", appointmentMessages.bucketMain],
          ["private", appointmentMessages.bucketPrivate],
          ["custom", appointmentMessages.bucketCustom],
        ]
  ) as [FinancialBucket, string][];

  const showAmount = kind === "quote" || kind === "job";
  const saving = state === "saving";

  return (
    <div className={styles.form}>
      {real ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor="work-client">
            {opsMessages.clientPickerLabel}
          </label>
          <select suppressHydrationWarning
            id="work-client"
            className={styles.select}
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="">{opsMessages.clientNone}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {(!real || !clientId) && (
        <Input
          label={real ? opsMessages.prospectNameLabel : messages.clientLabel}
          placeholder={messages.clientPlaceholder}
          value={clientName}
          onChange={(event) => setClientName(event.target.value)}
        />
      )}
      <Input
        label={messages.titleLabel}
        placeholder={messages.titlePlaceholder}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      {kind === "lead" && real ? (
        <Input
          label={opsMessages.sourceLabel}
          value={source}
          onChange={(event) => setSource(event.target.value)}
        />
      ) : null}
      {showAmount && !hasItems && (
        <Input
          label={messages.amountLabel}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      )}
      {kind === "lead" && real ? (
        <Input
          label={messages.amountLabel}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      ) : null}

      {kind === "quote" && real ? (
        <>
          <Input
            label={opsMessages.validUntilLabel}
            type="date"
            value={validUntil}
            onChange={(event) => setValidUntil(event.target.value)}
          />
          <div className={styles.field}>
            <span className={styles.label}>{opsMessages.itemsLabel}</span>
            {items.map((item, index) => (
              <div key={index} className={styles.itemRow}>
                <input suppressHydrationWarning
                  className={styles.itemInput}
                  aria-label={opsMessages.itemDescription}
                  placeholder={opsMessages.itemDescription}
                  value={item.description}
                  onChange={(e) =>
                    setItems(
                      items.map((x, i) =>
                        i === index ? { ...x, description: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input suppressHydrationWarning
                  className={`${styles.itemInput} ${styles.itemNumber}`}
                  aria-label={opsMessages.itemQuantity}
                  inputMode="decimal"
                  value={item.quantity}
                  onChange={(e) =>
                    setItems(
                      items.map((x, i) =>
                        i === index ? { ...x, quantity: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input suppressHydrationWarning
                  className={`${styles.itemInput} ${styles.itemNumber}`}
                  aria-label={opsMessages.itemUnitPrice}
                  inputMode="decimal"
                  value={item.unitPrice}
                  onChange={(e) =>
                    setItems(
                      items.map((x, i) =>
                        i === index ? { ...x, unitPrice: e.target.value } : x,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className={styles.itemRemove}
                  aria-label={opsMessages.removeItem}
                  onClick={() => setItems(items.filter((_, i) => i !== index))}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.actionButton}
              onClick={() =>
                setItems([
                  ...items,
                  { description: "", quantity: "1", unitPrice: "0" },
                ])
              }
            >
              {opsMessages.addItem}
            </button>
          </div>
        </>
      ) : null}

      {kind === "job" && real ? (
        <>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="work-staff">
              {opsMessages.staffLabel}
            </label>
            <select suppressHydrationWarning
              id="work-staff"
              className={styles.select}
              value={staffId}
              onChange={(event) => setStaffId(event.target.value)}
            >
              <option value="">{opsMessages.staffNone}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            label={opsMessages.startsOnLabel}
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
          <Input
            label={opsMessages.dueOnLabel}
            type="date"
            value={dueOn}
            min={startsOn || undefined}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </>
      ) : null}
      {kind === "project" && real ? (
        <>
          <Input
            label={opsMessages.startsOnLabel}
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
          />
          <Input
            label={opsMessages.endsOnLabel}
            type="date"
            value={endsOn}
            min={startsOn || undefined}
            onChange={(event) => setEndsOn(event.target.value)}
          />
        </>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="work-notes">
          {messages.notesLabel}
        </label>
        <textarea
          suppressHydrationWarning
          id="work-notes"
          className={styles.textarea}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {editing ? (
        <p className={styles.bucketNote}>{opsMessages.keepsPrivacyNote}</p>
      ) : (
        <>
          <div className={styles.field}>
            <span className={styles.label}>{messages.visibilityLabel}</span>
            <div className={styles.optionRow}>
              {visibilityOptions.map(([value, label]) => (
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
            <span className={styles.label}>
              {messages.financialBucketLabel}
            </span>
            <div className={styles.optionRow}>
              {bucketOptions.map(([value, label]) => (
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
        </>
      )}

      <SaveStatus
        state={
          state === "saving" ? "saving" : state === "error" ? "error" : "idle"
        }
        labels={opsMessages.saveLabels}
        error={errorText}
      />
      <Button fullWidth onClick={handleSave} disabled={saving}>
        {saving ? opsMessages.saveLabels.saving : messages.save}
      </Button>
    </div>
  );
}
