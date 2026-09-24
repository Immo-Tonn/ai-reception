"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Icon } from "@/components/ui";
import { useInvoices } from "@/features/finance/useInvoices";
import { calculateRevenue, calculateOutstanding } from "@/features/finance/calculations";
import { useAuditLog } from "@/features/auditLog/useAuditLog";
import { useClients } from "@/features/clients/useClients";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import type { Invoice } from "@/features/finance/types";
import type { FinancialBucket } from "@/features/appointments/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { NewInvoiceSheet } from "./NewInvoiceSheet";
import { InvoiceDetailSheet } from "./InvoiceDetailSheet";
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageIntro = getWorkspaceConfig(workspaceSlug).financeIntro?.[locale];
  const { items: invoices, create, update } = useInvoices(workspaceSlug);
  const { items: clients } = useClients(workspaceSlug);
  const { log } = useAuditLog(workspaceSlug);
  const [filter, setFilter] = useState<"all" | FinancialBucket>("all");
  const [sheetOpen, setSheetOpen] = useState(searchParams.get("create") === "invoice");
  // Store only the id and derive the live object from `invoices` on every
  // render — same reasoning as Calendar's Quick Actions target: holding
  // the Invoice object itself would freeze a stale snapshot after
  // mark-as-paid, edit, etc.
  const [detailTargetId, setDetailTargetId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const detailTarget = invoices.find((i) => i.id === detailTargetId) ?? null;
  const editingInvoice = invoices.find((i) => i.id === editingId) ?? null;

  // A `?invoice=<number>` deep link (Today's "needs attention" item)
  // highlights and scrolls to that exact row instead of leaving the
  // user to find it again in the list.
  const highlightNumber = searchParams.get("invoice");
  const highlightRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (highlightNumber) highlightRef.current?.scrollIntoView({ block: "center" });
  }, [highlightNumber]);

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

  async function handleSaveInvoice(invoice: Invoice) {
    const exists = invoices.some((i) => i.id === invoice.id);
    if (exists) {
      await update(invoice.id, invoice);
      log({
        action: "updated",
        entityType: "invoice",
        entityId: invoice.id,
        summary: `${invoice.number}: ${invoice.client} · ${formatCurrency(invoice.amount, invoice.currency, locale)}`,
        source: "user",
      });
      return;
    }
    await create(invoice);
    log({
      action: "created",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `${messages.newInvoice}: ${invoice.client} · ${formatCurrency(invoice.amount, invoice.currency, locale)}`,
      source: "user",
    });
  }

  async function handleTogglePaid(invoice: Invoice) {
    const nextStatus = invoice.status === "paid" ? "unpaid" : "paid";
    await update(invoice.id, { status: nextStatus });
    log({
      action: "statusChanged",
      entityType: "invoice",
      entityId: invoice.id,
      summary: `${invoice.number}: ${nextStatus === "paid" ? messages.statusPaid : messages.statusUnpaid}`,
      source: "user",
    });
  }

  function handleOpenClient(invoice: Invoice) {
    const client = clients.find((c) => c.name === invoice.client);
    router.push(client ? `/${workspaceSlug}/clients/${client.id}` : `/${workspaceSlug}/clients`);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
        <Button className={styles.newButton} onClick={() => setSheetOpen(true)}>
          {messages.newInvoice}
        </Button>
      </header>

      {pageIntro && <p className={styles.pageIntro}>{pageIntro}</p>}

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
          {filteredInvoices.map((invoice) => {
            const isHighlighted = invoice.number.replace(/^#/, "") === highlightNumber;
            return (
              <button
                key={invoice.id}
                type="button"
                ref={isHighlighted ? highlightRef : undefined}
                className={`${styles.row} ${styles.rowButton} ${isHighlighted ? styles.rowHighlighted : ""}`}
                onClick={() => setDetailTargetId(invoice.id)}
              >
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
                <Icon name="chevronRight" size={16} className={styles.rowChevron} />
              </button>
            );
          })}
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

      <InvoiceDetailSheet
        open={Boolean(detailTarget)}
        onClose={() => setDetailTargetId(null)}
        invoice={detailTarget}
        locale={locale}
        messages={messages}
        appointmentMessages={appointmentMessages}
        onTogglePaid={() => detailTarget && handleTogglePaid(detailTarget)}
        onEdit={() => {
          if (!detailTarget) return;
          setEditingId(detailTarget.id);
          setDetailTargetId(null);
        }}
        onOpenClient={() => detailTarget && handleOpenClient(detailTarget)}
      />

      <NewInvoiceSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSave={handleSaveInvoice}
        messages={messages}
        appointmentMessages={appointmentMessages}
      />

      <NewInvoiceSheet
        key={editingInvoice?.id ?? "edit-none"}
        open={Boolean(editingInvoice)}
        onClose={() => setEditingId(null)}
        onSave={handleSaveInvoice}
        messages={messages}
        appointmentMessages={appointmentMessages}
        initialValue={editingInvoice}
      />
    </main>
  );
}
