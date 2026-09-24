"use client";

import { Button, Icon, Sheet } from "@/components/ui";
import type { Invoice } from "@/features/finance/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import styles from "./InvoiceDetailSheet.module.css";

const statusBadgeClass: Record<Invoice["status"], string> = {
  paid: "badgePaid",
  unpaid: "badgeUnpaid",
  partial: "badgePartial",
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

export function InvoiceDetailSheet({
  open,
  onClose,
  invoice,
  locale,
  messages,
  appointmentMessages,
  onTogglePaid,
  onEdit,
  onOpenClient,
}: {
  open: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  locale: Locale;
  messages: Messages["finance"];
  appointmentMessages: Messages["appointment"];
  onTogglePaid: () => void;
  onEdit: () => void;
  onOpenClient: () => void;
}) {
  if (!invoice) return null;

  const statusLabel: Record<Invoice["status"], string> = {
    paid: messages.statusPaid,
    unpaid: messages.statusUnpaid,
    partial: messages.statusPartial,
  };

  return (
    <Sheet open={open} onClose={onClose} title={invoice.number}>
      <div className={styles.summary}>
        <span className={styles.summaryTitle}>{invoice.client}</span>
        <span className={styles.summaryMeta}>
          {invoice.number} · {formatDate(new Date(invoice.date), locale, { dateStyle: "medium" })}
        </span>
        <span className={styles.summaryAmount}>
          {formatCurrency(invoice.amount, invoice.currency, locale)}
        </span>
      </div>

      <div className={styles.fields}>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{messages.detailStatusLabel}</span>
          <span className={`${styles.badge} ${styles[statusBadgeClass[invoice.status]]}`}>
            {statusLabel[invoice.status]}
          </span>
        </div>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{appointmentMessages.financialBucketLabel}</span>
          <span className={styles.fieldValue}>{appointmentMessages[bucketLabelKey[invoice.bucket]]}</span>
        </div>
        <div className={styles.fieldRow}>
          <span className={styles.fieldLabel}>{appointmentMessages.visibilityLabel}</span>
          <span className={styles.fieldValue}>
            {appointmentMessages[visibilityLabelKey[invoice.visibility]]}
          </span>
        </div>
      </div>

      <div className={styles.list}>
        {invoice.status !== "paid" && (
          <button type="button" className={styles.item} onClick={onTogglePaid}>
            <span className={styles.itemIcon}>
              <Icon name="check" size={16} />
            </span>
            {messages.markAsPaid}
          </button>
        )}
        {invoice.status === "paid" && (
          <button type="button" className={styles.item} onClick={onTogglePaid}>
            <span className={styles.itemIcon}>
              <Icon name="close" size={16} />
            </span>
            {messages.markAsUnpaid}
          </button>
        )}
        <button type="button" className={styles.item} onClick={onEdit}>
          <span className={styles.itemIcon}>
            <Icon name="check" size={16} />
          </span>
          {messages.editInvoice}
        </button>
        <button type="button" className={styles.item} onClick={onOpenClient}>
          <span className={styles.itemIcon}>
            <Icon name="clients" size={16} />
          </span>
          {messages.openClient}
        </button>
      </div>

      <div className={styles.closeRow}>
        <Button variant="secondary" fullWidth onClick={onClose}>
          {messages.close}
        </Button>
      </div>
    </Sheet>
  );
}
