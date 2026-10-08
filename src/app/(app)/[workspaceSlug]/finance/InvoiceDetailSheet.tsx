"use client";

import { useState } from "react";
import { Button, Icon, Input, SaveStatus, Sheet, type SaveState } from "@/components/ui";
import type { Invoice, PaymentMethod } from "@/features/finance/types";
import { describeSaveError } from "@/lib/repository/describeSaveError";
import { fromMinor, lineTotalMinor, toMinor } from "@/lib/money";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import styles from "./InvoiceDetailSheet.module.css";

export const statusBadgeClass: Record<Invoice["status"], string> = {
  paid: "badgePaid",
  unpaid: "badgeUnpaid",
  partial: "badgePartial",
  draft: "badgeDraft",
  overdue: "badgeOverdue",
  cancelled: "badgeCancelled",
};

const bucketLabelKey = {
  main: "bucketMain",
  private: "bucketPrivate",
  custom: "bucketCustom",
} as const;

const visibilityLabelKey = {
  normal: "visibilityNormal",
  private: "visibilityPrivate",
  ownerOnly: "visibilityOwnerOnly",
  custom: "visibilityCustom",
} as const;

const METHODS: PaymentMethod[] = ["cash", "bank_transfer", "card", "online", "custom"];

export function InvoiceDetailSheet({
  open,
  onClose,
  invoice,
  locale,
  messages,
  appointmentMessages,
  errorMessages,
  statusLabels,
  canEdit,
  onRecordPayment,
  onMarkPaid,
  onMarkUnpaid,
  onIssue,
  onCancel,
  onEdit,
  onOpenClient,
}: {
  open: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  locale: Locale;
  messages: Messages["finance"];
  appointmentMessages: Messages["appointment"];
  errorMessages: Messages["repositoryErrors"];
  statusLabels: { unsaved: string; saving: string; saved: string };
  canEdit: boolean;
  onRecordPayment: (invoice: Invoice, payment: { amount: number; method: PaymentMethod }) => Promise<unknown>;
  onMarkPaid: (invoice: Invoice) => Promise<unknown>;
  onMarkUnpaid: (invoice: Invoice) => Promise<unknown>;
  onIssue: (invoice: Invoice) => Promise<unknown>;
  onCancel: (invoice: Invoice) => Promise<unknown>;
  onEdit: () => void;
  onOpenClient: () => void;
}) {
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");

  if (!invoice) return null;

  const statusLabel: Record<Invoice["status"], string> = {
    paid: messages.statusPaid,
    unpaid: messages.statusUnpaid,
    partial: messages.statusPartial,
    draft: messages.statusDraft,
    overdue: messages.statusOverdue,
    cancelled: messages.statusCancelled,
  };
  const methodLabel: Record<PaymentMethod, string> = {
    cash: messages.methodCash,
    bank_transfer: messages.methodBankTransfer,
    card: messages.methodCard,
    online: messages.methodOnline,
    custom: messages.methodCustom,
  };
  const money = (value: number) => formatCurrency(value, invoice.currency, locale);
  const paidMinor = toMinor(invoice.paidAmount ?? (invoice.status === "paid" ? invoice.amount : 0));
  const balanceMinor = toMinor(invoice.amount) - paidMinor;
  const cancelled = invoice.status === "cancelled";
  const canPay = canEdit && !cancelled && balanceMinor > 0;
  const hasPayments = paidMinor > 0;

  async function run(work: () => Promise<unknown>, after?: () => void) {
    setState("saving");
    setError(null);
    try {
      await work();
      setState("saved");
      after?.();
    } catch (e) {
      setState("error");
      setError(describeSaveError(e, errorMessages));
    }
  }

  function openPaymentForm() {
    setAmountText(String(fromMinor(balanceMinor)));
    setPaying(true);
    setConfirmCancel(false);
    setState("idle");
  }

  function submitPayment() {
    if (!invoice) return;
    const parsed = Number(amountText.trim().replace(",", "."));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setState("error");
      setError(errorMessages.invalidInput);
      return;
    }
    void run(() => onRecordPayment(invoice, { amount: parsed, method }), () => setPaying(false));
  }

  return (
    <Sheet open={open} onClose={onClose} title={invoice.number}>
      <div className={styles.summary}>
        <span className={styles.summaryTitle}>{invoice.client}</span>
        <span className={styles.summaryMeta}>
          {invoice.number} · {formatDate(new Date(invoice.date), locale, { dateStyle: "medium" })}
        </span>
        <span className={styles.summaryAmount}>{money(invoice.amount)}</span>
      </div>

      <div className={styles.fields}>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{messages.detailStatusLabel}</span>
          <span className={`${styles.badge} ${styles[statusBadgeClass[invoice.status]]}`}>{statusLabel[invoice.status]}</span>
        </div>
        {invoice.dueDate && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{messages.dueDateLabel}</span>
            <span className={styles.fieldValue}>{formatDate(new Date(invoice.dueDate), locale, { dateStyle: "medium" })}</span>
          </div>
        )}
        {!cancelled && (
          <div className={styles.fieldRow}>
            <span className={styles.fieldLabel}>{messages.paidLabel} / {messages.balanceLabel}</span>
            <span className={styles.fieldValue}>{money(fromMinor(paidMinor))} / {money(fromMinor(balanceMinor))}</span>
          </div>
        )}
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{appointmentMessages.financialBucketLabel}</span>
          <span className={styles.fieldValue}>{appointmentMessages[bucketLabelKey[invoice.bucket]]}</span>
        </div>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{appointmentMessages.visibilityLabel}</span>
          <span className={styles.fieldValue}>{appointmentMessages[visibilityLabelKey[invoice.visibility]]}</span>
        </div>
      </div>

      {invoice.items && invoice.items.length > 0 && (
        <div className={styles.fields}>
          <span className={styles.fieldLabel}>{messages.itemsTitle}</span>
          {invoice.items.map((item, index) => (
            <div key={item.id ?? index} className={styles.fieldRow}>
              <span className={styles.fieldValue}>
                {item.description}
                <span className={styles.fieldLabel}> · {item.quantity} × {money(item.unitPrice)}</span>
              </span>
              <span className={styles.fieldValue}>{money(fromMinor(lineTotalMinor(item.quantity, item.unitPrice)))}</span>
            </div>
          ))}
        </div>
      )}

      {invoice.payments && invoice.payments.length > 0 && (
        <div className={styles.fields}>
          <span className={styles.fieldLabel}>{messages.paymentsTitle}</span>
          {invoice.payments.map((p) => (
            <div key={p.id} className={styles.fieldRow}>
              <span className={styles.fieldLabel}>
                {formatDate(new Date(p.paidAt), locale, { dateStyle: "medium" })} · {methodLabel[p.method]}
                {p.voided ? ` · ${messages.paymentVoided}` : ""}
              </span>
              <span className={styles.fieldValue}>{money(p.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {invoice.notes && <p className={styles.notes}>{invoice.notes}</p>}

      {paying && canPay && (
        <div className={styles.paymentForm}>
          <Input
            label={messages.paymentAmountLabel}
            inputMode="decimal"
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
          />
          <label className={styles.fieldLabel} htmlFor="payment-method">{messages.paymentMethodLabel}</label>
          <select
            id="payment-method"
            suppressHydrationWarning
            className={styles.select}
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>{methodLabel[m]}</option>
            ))}
          </select>
          <Button fullWidth disabled={state === "saving"} onClick={submitPayment}>{messages.paymentSave}</Button>
        </div>
      )}

      <SaveStatus state={state} labels={statusLabels} error={error} onSavedExpire={() => setState("idle")} />

      {!canEdit && <p className={styles.notes}>{messages.readOnlyNote}</p>}

      {canEdit && !cancelled && (
        <div className={styles.list}>
          {invoice.status === "draft" && (
            <button type="button" className={styles.item} disabled={state === "saving"} onClick={() => void run(() => onIssue(invoice))}>
              <span className={styles.itemIcon}><Icon name="check" size={16} /></span>
              {messages.issueInvoice}
            </button>
          )}
          {canPay && (
            <button type="button" className={styles.item} disabled={state === "saving"} onClick={openPaymentForm}>
              <span className={styles.itemIcon}><Icon name="check" size={16} /></span>
              {messages.recordPayment}
            </button>
          )}
          {canPay && (
            <button type="button" className={styles.item} disabled={state === "saving"} onClick={() => void run(() => onMarkPaid(invoice))}>
              <span className={styles.itemIcon}><Icon name="check" size={16} /></span>
              {messages.markAsPaid}
            </button>
          )}
          {hasPayments && (
            <button type="button" className={styles.item} disabled={state === "saving"} onClick={() => void run(() => onMarkUnpaid(invoice))}>
              <span className={styles.itemIcon}><Icon name="close" size={16} /></span>
              {messages.markAsUnpaid}
            </button>
          )}
          <button type="button" className={styles.item} onClick={onEdit}>
            <span className={styles.itemIcon}><Icon name="check" size={16} /></span>
            {messages.editInvoice}
          </button>
          {!hasPayments && !confirmCancel && (
            <button type="button" className={styles.item} onClick={() => setConfirmCancel(true)}>
              <span className={styles.itemIcon}><Icon name="close" size={16} /></span>
              {messages.cancelInvoice}
            </button>
          )}
          {hasPayments && <p className={styles.notes}>{messages.cancelInvoiceHasPayments}</p>}
          {confirmCancel && (
            <div className={styles.paymentForm}>
              <p className={styles.notes}>{messages.cancelInvoiceConfirm}</p>
              <Button
                fullWidth
                disabled={state === "saving"}
                onClick={() => void run(() => onCancel(invoice), () => setConfirmCancel(false))}
              >
                {messages.cancelInvoice}
              </Button>
              <Button fullWidth variant="secondary" onClick={() => setConfirmCancel(false)}>{messages.cancelInvoiceKeep}</Button>
            </div>
          )}
        </div>
      )}

      <div className={styles.list}>
        {invoice.clientId !== null && (
          <button type="button" className={styles.item} onClick={onOpenClient}>
            <span className={styles.itemIcon}><Icon name="clients" size={16} /></span>
            {messages.openClient}
          </button>
        )}
      </div>

      <div className={styles.closeRow}>
        <Button variant="secondary" fullWidth onClick={onClose}>{messages.close}</Button>
      </div>
    </Sheet>
  );
}
