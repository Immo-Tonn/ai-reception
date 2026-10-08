"use client";

import { useState } from "react";
import { Button, Input, SaveStatus, Sheet, type SaveState } from "@/components/ui";
import { useClients } from "@/features/clients/useClients";
import type { FinancialBucket, Visibility } from "@/features/appointments/types";
import type { InvoiceDraft, InvoiceEdit } from "@/features/finance/financeBackend";
import type { Invoice, InvoiceItem } from "@/features/finance/types";
import { describeSaveError } from "@/lib/repository/describeSaveError";
import { fromMinor, linesTotalMinor, MoneyError } from "@/lib/money";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency } from "@/lib/i18n/format";
import styles from "./NewInvoiceSheet.module.css";

interface ItemRow {
  key: number;
  description: string;
  quantity: string;
  unitPrice: string;
}

const OTHER_CLIENT = "";

function parseDecimal(text: string): number | null {
  const normalised = text.trim().replace(",", ".");
  if (normalised === "" || !/^\d*\.?\d*$/.test(normalised) || normalised === ".") return null;
  return Number(normalised);
}

function toItems(rows: ItemRow[]): InvoiceItem[] | null {
  const items: InvoiceItem[] = [];
  for (const row of rows) {
    const quantity = parseDecimal(row.quantity);
    const unitPrice = parseDecimal(row.unitPrice);
    if (!row.description.trim() || quantity === null || quantity <= 0 || unitPrice === null) return null;
    items.push({ description: row.description.trim(), quantity, unitPrice });
  }
  return items.length > 0 ? items : null;
}

const rowsFromInvoice = (invoice: Invoice | null | undefined): ItemRow[] =>
  invoice?.items && invoice.items.length > 0
    ? invoice.items.map((item, i) => ({ key: i, description: item.description, quantity: String(item.quantity), unitPrice: String(item.unitPrice) }))
    : [{ key: 0, description: "", quantity: "1", unitPrice: "" }];

/**
 * New / edit invoice. Real workspaces save through server actions (honest errors, SaveStatus); demo
 * workspaces through the local demo store. Editing preserves what this simple form cannot show: a custom
 * bucket id and owner_only / custom visibility stay untouched unless the person changes that field.
 */
export function NewInvoiceSheet({
  open,
  onClose,
  workspaceSlug,
  locale,
  messages,
  appointmentMessages,
  errorMessages,
  statusLabels,
  initialValue,
  today,
  currency,
  canUsePrivateBucket,
  onCreate,
  onUpdate,
}: {
  open: boolean;
  onClose: () => void;
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["finance"];
  appointmentMessages: Messages["appointment"];
  errorMessages: Messages["repositoryErrors"];
  statusLabels: { unsaved: string; saving: string; saved: string };
  /** Editing an existing invoice instead of creating one — pass a `key={invoice.id}` at the call site. */
  initialValue?: Invoice | null;
  /** Workspace-local calendar day (useWorkspaceToday) used as the new invoice date. */
  today: string;
  currency: string;
  canUsePrivateBucket: boolean;
  onCreate: (draft: InvoiceDraft) => Promise<unknown>;
  onUpdate: (id: string, patch: InvoiceEdit) => Promise<unknown>;
}) {
  const { items: clients } = useClients(workspaceSlug);
  const isEditing = Boolean(initialValue);
  // Paid and cancelled invoices keep their lines (the database locks them too).
  const itemsLocked = initialValue?.status === "paid" || initialValue?.status === "cancelled";

  const [clientId, setClientId] = useState<string>(initialValue?.clientId ?? OTHER_CLIENT);
  const [clientName, setClientName] = useState(initialValue?.client ?? "");
  const [rows, setRows] = useState<ItemRow[]>(() => rowsFromInvoice(initialValue));
  const [nextKey, setNextKey] = useState(1000);
  const [bucket, setBucket] = useState<FinancialBucket>(initialValue?.bucket ?? "main");
  const [visibility, setVisibility] = useState<Visibility>(initialValue?.visibility ?? "normal");
  const [dueDate, setDueDate] = useState(initialValue?.dueDate ?? "");
  const [notes, setNotes] = useState(initialValue?.notes ?? "");
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const parsedItems = toItems(rows);
  const totalMinor = (() => {
    try {
      return linesTotalMinor(
        rows.map((r) => ({ quantity: parseDecimal(r.quantity) ?? 0, unitPrice: parseDecimal(r.unitPrice) ?? 0 })),
      );
    } catch (e) {
      if (e instanceof MoneyError) return 0;
      throw e;
    }
  })();
  const shownCurrency = initialValue?.currency || currency;

  function touch() {
    setState("dirty");
    setError(null);
  }
  function updateRow(key: number, patch: Partial<ItemRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    touch();
  }

  const selectedClient = clients.find((c) => c.id === clientId);
  const resolvedClientName = clientId !== OTHER_CLIENT ? (selectedClient?.name ?? clientName) : clientName.trim();

  function validate(): string | null {
    if (!resolvedClientName) return messages.clientRequired;
    if (!itemsLocked && !parsedItems) return messages.itemsRequired;
    return null;
  }

  async function submit(status: "draft" | "unpaid") {
    const problem = validate();
    if (problem) {
      setState("error");
      setError(problem);
      return;
    }
    setState("saving");
    setError(null);
    try {
      if (isEditing && initialValue) {
        const patch: InvoiceEdit = {};
        if (clientId !== (initialValue.clientId ?? OTHER_CLIENT) || resolvedClientName !== initialValue.client) {
          patch.client = resolvedClientName;
          patch.clientId = clientId === OTHER_CLIENT ? null : clientId;
        }
        if (!itemsLocked && parsedItems && JSON.stringify(parsedItems.map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice }))) !==
          JSON.stringify((initialValue.items ?? []).map(({ description, quantity, unitPrice }) => ({ description, quantity, unitPrice })))) {
          patch.items = parsedItems;
        }
        // Only a CHANGED field is sent: a custom bucket / owner_only / custom visibility survives a plain edit.
        if (bucket !== initialValue.bucket) patch.bucket = bucket;
        if (visibility !== initialValue.visibility) patch.visibility = visibility;
        if ((dueDate || null) !== (initialValue.dueDate ?? null)) patch.dueDate = dueDate || null;
        if (notes !== (initialValue.notes ?? "")) patch.notes = notes;
        if (Object.keys(patch).length > 0) await onUpdate(initialValue.id, patch);
        setState("saved");
        onClose();
        return;
      }
      await onCreate({
        client: resolvedClientName,
        clientId: clientId === OTHER_CLIENT ? null : clientId,
        items: parsedItems ?? [],
        bucket,
        financialBucketId: null,
        visibility,
        dueDate: dueDate || null,
        notes,
        currency,
        status,
        date: today,
      });
      setState("saved");
      onClose();
    } catch (e) {
      setState("error");
      setError(describeSaveError(e, errorMessages));
    }
  }

  const bucketOptions: FinancialBucket[] = ["main"];
  if (canUsePrivateBucket || bucket === "private") bucketOptions.push("private");
  if (bucket === "custom") bucketOptions.push("custom"); // preserved, not creatable here
  const visibilityOptions: Visibility[] = ["normal", "private"];
  if (visibility === "ownerOnly" || visibility === "custom") visibilityOptions.push(visibility); // preserved

  const bucketLabel = (b: FinancialBucket) => (b === "main" ? messages.filterMain : b === "private" ? messages.filterPrivate : appointmentMessages.bucketCustom);
  const visibilityLabel = (v: Visibility) =>
    v === "normal"
      ? appointmentMessages.visibilityNormal
      : v === "private"
        ? appointmentMessages.visibilityPrivate
        : v === "ownerOnly"
          ? appointmentMessages.visibilityOwnerOnly
          : appointmentMessages.visibilityCustom;

  return (
    <Sheet open={open} onClose={onClose} title={isEditing ? messages.editInvoice : messages.newInvoice}>
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="invoice-client">{messages.clientPickerLabel}</label>
          <select
            id="invoice-client"
            suppressHydrationWarning
            className={styles.select}
            value={clientId}
            onChange={(event) => {
              setClientId(event.target.value);
              touch();
            }}
          >
            <option value={OTHER_CLIENT}>{messages.clientPickerNone}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {clientId === OTHER_CLIENT && (
          <Input
            label={messages.clientNameFreeText}
            value={clientName}
            maxLength={200}
            onChange={(event) => {
              setClientName(event.target.value);
              touch();
            }}
          />
        )}

        <fieldset className={styles.items}>
          <legend className={styles.label}>{messages.itemsTitle}</legend>
          {rows.map((row) => (
            <div key={row.key} className={styles.itemRow}>
              <Input
                label={messages.itemDescriptionLabel}
                value={row.description}
                maxLength={200}
                disabled={itemsLocked}
                onChange={(event) => updateRow(row.key, { description: event.target.value })}
              />
              <div className={styles.itemNumbers}>
                <Input
                  label={messages.itemQuantityLabel}
                  inputMode="decimal"
                  value={row.quantity}
                  disabled={itemsLocked}
                  onChange={(event) => updateRow(row.key, { quantity: event.target.value })}
                />
                <Input
                  label={messages.itemUnitPriceLabel}
                  inputMode="decimal"
                  value={row.unitPrice}
                  disabled={itemsLocked}
                  onChange={(event) => updateRow(row.key, { unitPrice: event.target.value })}
                />
                {!itemsLocked && rows.length > 1 && (
                  <button
                    type="button"
                    className={styles.removeItem}
                    aria-label={messages.removeItem}
                    onClick={() => {
                      setRows((current) => current.filter((r) => r.key !== row.key));
                      touch();
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
          {!itemsLocked && rows.length < 100 && (
            <Button
              variant="secondary"
              onClick={() => {
                setRows((current) => [...current, { key: nextKey, description: "", quantity: "1", unitPrice: "" }]);
                setNextKey((k) => k + 1);
                touch();
              }}
            >
              {messages.addItem}
            </Button>
          )}
          <div className={styles.total}>
            <span>{messages.totalLabel}</span>
            <strong>{formatCurrency(fromMinor(totalMinor), shownCurrency, locale)}</strong>
          </div>
        </fieldset>

        <Input
          label={messages.dueDateLabel}
          type="date"
          value={dueDate}
          min={initialValue?.date ?? today}
          onChange={(event) => {
            setDueDate(event.target.value);
            touch();
          }}
        />
        <div className={styles.field}>
          <label className={styles.label} htmlFor="invoice-notes">{messages.notesLabel}</label>
          <textarea
            id="invoice-notes"
            suppressHydrationWarning
            className={styles.textarea}
            rows={3}
            maxLength={2000}
            value={notes}
            onChange={(event) => {
              setNotes(event.target.value);
              touch();
            }}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="invoice-bucket">{appointmentMessages.financialBucketLabel}</label>
          <select
            id="invoice-bucket"
            suppressHydrationWarning
            className={styles.select}
            value={bucket}
            onChange={(event) => {
              setBucket(event.target.value as FinancialBucket);
              touch();
            }}
          >
            {bucketOptions.map((b) => (
              <option key={b} value={b}>{bucketLabel(b)}</option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="invoice-visibility">{appointmentMessages.visibilityLabel}</label>
          <select
            id="invoice-visibility"
            suppressHydrationWarning
            className={styles.select}
            value={visibility}
            onChange={(event) => {
              setVisibility(event.target.value as Visibility);
              touch();
            }}
          >
            {visibilityOptions.map((v) => (
              <option key={v} value={v}>{visibilityLabel(v)}</option>
            ))}
          </select>
        </div>
        <span className={styles.separationNote}>{appointmentMessages.separationNote}</span>

        <SaveStatus
          state={state}
          labels={statusLabels}
          error={error}
          onSavedExpire={() => setState("idle")}
        />
        <Button fullWidth disabled={state === "saving"} onClick={() => submit("unpaid")}>
          {isEditing ? messages.saveInvoice : messages.newInvoiceSave}
        </Button>
        {!isEditing && (
          <Button fullWidth variant="secondary" disabled={state === "saving"} onClick={() => submit("draft")}>
            {messages.saveAsDraft}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
