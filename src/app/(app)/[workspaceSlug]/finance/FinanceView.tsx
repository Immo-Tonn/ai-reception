"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Icon } from "@/components/ui";
import { useFinance } from "@/features/finance/useFinance";
import { calculateRevenue, calculateOutstanding } from "@/features/finance/calculations";
import { useAuditLog } from "@/features/auditLog/useAuditLog";
import { getWorkspaceConfig, isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { RemoteRepositoryError } from "@/lib/repository/createRemoteRepository";
import { describeSaveError } from "@/lib/repository/describeSaveError";
import { fromMinor, toMinor } from "@/lib/money";
import type { InvoiceDraft, InvoiceEdit } from "@/features/finance/financeBackend";
import { useWorkspaceToday } from "@/features/workspace/WorkspaceCatalog";
import type { Invoice } from "@/features/finance/types";
import type { FinancialBucket } from "@/features/appointments/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { NewInvoiceSheet } from "./NewInvoiceSheet";
import { InvoiceDetailSheet, statusBadgeClass } from "./InvoiceDetailSheet";
import styles from "./page.module.css";

export function FinanceView({
  workspaceSlug,
  locale,
  messages,
  appointmentMessages,
  errorMessages,
  statusLabels,
  defaultCurrency,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["finance"];
  appointmentMessages: Messages["appointment"];
  errorMessages: Messages["repositoryErrors"];
  statusLabels: { unsaved: string; saving: string; saved: string };
  defaultCurrency: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const config = getWorkspaceConfig(workspaceSlug);
  const pageIntro = config.financeIntro?.[locale];
  const isDemo = isDemoWorkspaceSlug(workspaceSlug);
  const finance = useFinance(workspaceSlug);
  const { invoices, capabilities, loaded, loadError } = finance;
  const { log } = useAuditLog(workspaceSlug);
  const today = useWorkspaceToday(workspaceSlug);
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

  // Recomputed from live invoice data on every render. For a real workspace `invoices` holds ONLY rows
  // this person may see (filtered in the database and again on the server), so a Private total can never
  // be derived here without the permission.
  const revenue = calculateRevenue(invoices, defaultCurrency);
  const outstanding = calculateOutstanding(invoices);
  const showPrivate = capabilities.canUsePrivateBucket;

  const filteredInvoices = useMemo(
    () => invoices.filter((item) => filter === "all" || item.bucket === filter),
    [invoices, filter],
  );

  const statusLabel: Record<Invoice["status"], string> = {
    paid: messages.statusPaid,
    unpaid: messages.statusUnpaid,
    partial: messages.statusPartial,
    draft: messages.statusDraft,
    overdue: messages.statusOverdue,
    cancelled: messages.statusCancelled,
  };

  // Demo only: the real audit entries are written by the server (one per change).
  function demoLog(action: "created" | "updated" | "statusChanged" | "cancelled", invoice: Pick<Invoice, "id" | "number">, text: string) {
    if (isDemo) log({ action, entityType: "invoice", entityId: invoice.id, summary: `${invoice.number}: ${text}`, source: "user" });
  }

  async function handleCreate(draft: InvoiceDraft) {
    const created = await finance.create(draft);
    demoLog("created", created, messages.newInvoice);
  }

  async function handleUpdate(id: string, patch: InvoiceEdit) {
    const updated = await finance.update(id, patch);
    if (updated) demoLog("updated", updated, messages.editInvoice);
  }

  const balanceOf = (invoice: Invoice) => fromMinor(toMinor(invoice.amount) - toMinor(invoice.paidAmount ?? (invoice.status === "paid" ? invoice.amount : 0)));

  async function handleMarkPaid(invoice: Invoice) {
    const updated = await finance.recordPayment(invoice.id, { amount: balanceOf(invoice), method: "cash" });
    if (updated) demoLog("statusChanged", updated, messages.statusPaid);
  }

  async function handleRecordPayment(invoice: Invoice, payment: { amount: number; method: Parameters<typeof finance.recordPayment>[1]["method"] }) {
    const updated = await finance.recordPayment(invoice.id, payment);
    if (updated) demoLog("statusChanged", updated, messages.recordPayment);
  }

  async function handleMarkUnpaid(invoice: Invoice) {
    const updated = await finance.markUnpaid(invoice.id);
    if (updated) demoLog("statusChanged", updated, messages.statusUnpaid);
  }

  async function handleIssue(invoice: Invoice) {
    const updated = await finance.issue(invoice.id);
    if (updated) demoLog("statusChanged", updated, messages.statusUnpaid);
  }

  async function handleCancel(invoice: Invoice) {
    const updated = await finance.cancel(invoice.id);
    if (updated) demoLog("cancelled", updated, messages.statusCancelled);
  }

  function handleOpenClient(invoice: Invoice) {
    const clientId = invoice.clientId ?? config.clients.find((c) => c.name === invoice.client)?.id;
    router.push(clientId ? `/${workspaceSlug}/clients/${clientId}` : `/${workspaceSlug}/clients`);
  }

  const loadErrorText = loadError ? describeSaveError(new RemoteRepositoryError(loadError), errorMessages) : null;
  const editorOpen = capabilities.canEdit && (sheetOpen || Boolean(editingInvoice));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
        {capabilities.canEdit && (
          <Button className={styles.newButton} onClick={() => setSheetOpen(true)}>
            {messages.newInvoice}
          </Button>
        )}
      </header>

      {pageIntro && <p className={styles.pageIntro}>{pageIntro}</p>}

      {!loaded ? (
        <p className={styles.hint} role="status">{messages.loadingInvoices}</p>
      ) : loadErrorText ? (
        <div className={styles.stateBox} role="alert">
          <p className={styles.stateTitle}>{messages.loadErrorTitle}</p>
          <p className={styles.hint}>{loadErrorText}</p>
          <Button variant="secondary" onClick={() => void finance.refresh()}>{messages.retry}</Button>
        </div>
      ) : (
        <>
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
            {showPrivate && (
              <div className={styles.breakdownCard}>
                <div className={styles.breakdownLabel}>
                  <span className={styles.breakdownDotPrivate} />
                  {messages.filterPrivate}
                </div>
                <div className={styles.breakdownValue}>
                  {formatCurrency(revenue.private, revenue.currency, locale)}
                </div>
              </div>
            )}
          </div>

          <div className={styles.breakdownCard}>
            <div className={styles.breakdownLabel}>{messages.outstandingTitle}</div>
            <div className={styles.breakdownValue}>
              {formatCurrency(outstanding, revenue.currency, locale)}
            </div>
          </div>

          <h2 className={styles.sectionTitle}>{messages.invoicesTitle}</h2>

          <div className={styles.filterRow}>
            {(showPrivate ? (["all", "main", "private"] as const) : (["all", "main"] as const)).map((key) => (
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
          {!showPrivate && <p className={styles.hint}>{messages.privateBucketHint}</p>}
        </>
      )}

      {capabilities.canEdit && (
        <button
          type="button"
          className={styles.fab}
          onClick={() => setSheetOpen(true)}
          aria-label={messages.newInvoice}
        >
          <Icon name="plus" size={24} />
        </button>
      )}

      <InvoiceDetailSheet
        key={detailTarget?.id ?? "detail-none"}
        open={Boolean(detailTarget)}
        onClose={() => setDetailTargetId(null)}
        invoice={detailTarget}
        locale={locale}
        messages={messages}
        appointmentMessages={appointmentMessages}
        errorMessages={errorMessages}
        statusLabels={statusLabels}
        canEdit={capabilities.canEdit}
        onRecordPayment={handleRecordPayment}
        onMarkPaid={handleMarkPaid}
        onMarkUnpaid={handleMarkUnpaid}
        onIssue={handleIssue}
        onCancel={handleCancel}
        onEdit={() => {
          if (!detailTarget) return;
          setEditingId(detailTarget.id);
          setDetailTargetId(null);
        }}
        onOpenClient={() => detailTarget && handleOpenClient(detailTarget)}
      />

      {editorOpen && (
        <NewInvoiceSheet
          key={editingInvoice?.id ?? "new"}
          open
          onClose={() => {
            setSheetOpen(false);
            setEditingId(null);
          }}
          workspaceSlug={workspaceSlug}
          locale={locale}
          messages={messages}
          appointmentMessages={appointmentMessages}
          errorMessages={errorMessages}
          statusLabels={statusLabels}
          initialValue={editingInvoice}
          today={today}
          currency={defaultCurrency}
          canUsePrivateBucket={capabilities.canUsePrivateBucket}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
        />
      )}
    </main>
  );
}
