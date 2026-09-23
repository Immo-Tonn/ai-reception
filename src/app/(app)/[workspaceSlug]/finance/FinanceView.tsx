"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Icon } from "@/components/ui";
import { useInvoices } from "@/features/finance/useInvoices";
import { calculateRevenue, calculateOutstanding } from "@/features/finance/calculations";
import { useAuditLog } from "@/features/auditLog/useAuditLog";
import type { Invoice } from "@/features/finance/types";
import type { FinancialBucket } from "@/features/appointments/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { NewInvoiceSheet } from "./NewInvoiceSheet";
import styles from "./page.module.css";

const statusBadgeClass: Record<Invoice["status"], string> = {
  paid: "badgePaid",
  unpaid: "badgeUnpaid",
  partial: "badgePartial",
};

export function FinanceView({
  workspaceSlug,
  locale,
  messages,
  appointmentMessages,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["finance"];
  appointmentMessages: Messages["appointment"];
}) {
  const searchParams = useSearchParams();
  const { items: invoices, create } = useInvoices(workspaceSlug);
  const { log } = useAuditLog(workspaceSlug);
  const [filter, setFilter] = useState<"all" | FinancialBucket>("all");
  const [sheetOpen, setSheetOpen] = useState(searchParams.get("create") === "invoice");

  // Recomputed from live invoice data on every render — never a frozen
  // constant, so Main/Private/Combined stay correct after any change
  // (§ Calendar follow-up).
  const revenue = calculateRevenue(invoices);
  const outstanding = calculateOutstanding(invoices);

  const filteredInvoices = useMemo(
    () => invoices.filter((item) => filter === "all" || item.bucket === filter),
    [invoices, filter],
  );

  const statusLabel: Record<Invoice["status"], string> = {
    paid: messages.statusPaid,
    unpaid: messages.statusUnpaid,
    partial: messages.statusPartial,
  };

  async function handleCreateInvoice(invoice: Invoice) {
    await create(invoice);
    log({
      action: "created",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `${messages.newInvoice}: ${invoice.client} · ${formatCurrency(invoice.amount, invoice.currency, locale)}`,
      source: "user",
    });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
        <Button className={styles.newButton} onClick={() => setSheetOpen(true)}>
          {messages.newInvoice}
        </Button>
      </header>

      <div className={styles.summaryCard}>
        <div className={styles.summaryLabel}>{messages.revenueThisMonth}</div>
        <div className={styles.summaryValue}>
          {formatCurrency(revenue.combined, revenue.currency, locale)}
        </div>
      </div>

      <div className={styles.breakdownRow}>
        <div className={styles.breakdownCard}>
          <div className={styles.breakdownLabel}>
            <span className={styles.breakdownDotMain} />
            {messages.filterMain}
          </div>
          <div className={styles.breakdownValue}>
            {formatCurrency(revenue.main, revenue.currency, locale)}
          </div>
        </div>
        <div className={styles.breakdownCard}>
          <div className={styles.breakdownLabel}>
            <span className={styles.breakdownDotPrivate} />
            {messages.filterPrivate}
          </div>
          <div className={styles.breakdownValue}>
            {formatCurrency(revenue.private, revenue.currency, locale)}
          </div>
        </div>
      </div>

      <div className={styles.breakdownCard}>
        <div className={styles.breakdownLabel}>{messages.outstandingTitle}</div>
        <div className={styles.breakdownValue}>
          {formatCurrency(outstanding, revenue.currency, locale)}
        </div>
      </div>

      <h2 className={styles.sectionTitle}>{messages.invoicesTitle}</h2>

      <div className={styles.filterRow}>
        {(["all", "main", "private"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`${styles.filterChip} ${filter === key ? styles.filterChipActive : ""}`}
            onClick={() => setFilter(key)}
          >
            {key === "all" ? messages.filterAll : key === "main" ? messages.filterMain : messages.filterPrivate}
          </button>
        ))}
      </div>

      {filteredInvoices.length === 0 ? (
        <div className={styles.list}>
          <div className={styles.row}>
            <span className={styles.rowSubtitle}>{messages.noInvoices}</span>
          </div>
        </div>
      ) : (
        <div className={styles.list}>
          {filteredInvoices.map((invoice) => (
            <div key={invoice.id} className={styles.row}>
              <div className={styles.rowBody}>
                <span className={styles.rowTitle}>{invoice.client}</span>
                <span className={styles.rowSubtitle}>
                  {invoice.number} · {formatDate(new Date(invoice.date), locale, { dateStyle: "medium" })}
                </span>
              </div>
              <div className={styles.rowMeta}>
                <span className={styles.rowAmount}>
                  {formatCurrency(invoice.amount, invoice.currency, locale)}
                </span>
                <span className={`${styles.badge} ${styles[statusBadgeClass[invoice.status]]}`}>
                  {statusLabel[invoice.status]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className={styles.fab}
        onClick={() => setSheetOpen(true)}
        aria-label={messages.newInvoice}
      >
        <Icon name="plus" size={24} />
      </button>

      <NewInvoiceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSave={handleCreateInvoice}
        messages={messages}
        appointmentMessages={appointmentMessages}
      />
    </main>
  );
}
