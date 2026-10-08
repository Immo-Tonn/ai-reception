"use client";

import { useEffect, useState } from "react";
import { getClientRelatedAction } from "@/server/actions/crossModule.actions";
import type { ActionResult } from "@/server/actions/result";
import type { ClientRelated, RelatedWorkItem } from "@/features/crossModule/types";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency } from "@/lib/i18n/format";
import { fromMinor } from "@/lib/money";
import styles from "./page.module.css";

/**
 * Read-only "Related" panel (real workspaces): this client's leads / quotes / jobs / projects and invoices,
 * each linking to its module page. The server loader reads under the viewer's RLS; a section the viewer may
 * not read is absent from the response, so it is not rendered and was never sent to the browser.
 */
export function RelatedPanel({
  workspaceSlug,
  clientId,
  locale,
  messages,
}: {
  workspaceSlug: string;
  clientId: string;
  locale: Locale;
  messages: Messages["crossModule"];
}) {
  const [settled, setSettled] = useState<{ key: string; result: ActionResult<ClientRelated> } | null>(null);
  const key = `${workspaceSlug}|${clientId}`;

  useEffect(() => {
    let cancelled = false;
    getClientRelatedAction(workspaceSlug, clientId)
      .then((result) => {
        if (!cancelled) setSettled({ key, result });
      })
      .catch(() => {
        if (!cancelled) setSettled({ key, result: { ok: false, code: "unknown" } });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, clientId, key]);

  const current = settled && settled.key === key ? settled.result : null;
  const statusLabel = (code: string) => (messages.statuses as Record<string, string>)[code] ?? code;
  const invoiceLabel = (code: string) => (messages.invoiceStatuses as Record<string, string>)[code] ?? code;
  const money = (minor: number, currency: string) => formatCurrency(fromMinor(minor), currency, locale);

  const workGroups: { title: string; items: RelatedWorkItem[] }[] = current?.ok && current.data.work
    ? [
        { title: messages.leads, items: current.data.work.leads },
        { title: messages.quotes, items: current.data.work.quotes },
        { title: messages.jobs, items: current.data.work.jobs },
        { title: messages.projects, items: current.data.work.projects },
      ].filter((g) => g.items.length > 0)
    : [];
  const invoices = current?.ok ? (current.data.invoices ?? []) : [];

  // Demo workspaces (empty response) and viewers without any readable section show no panel at all.
  if (current?.ok && workGroups.length === 0 && invoices.length === 0 && !current.data.work && !current.data.invoices) return null;

  return (
    <section aria-labelledby="client-related-title" style={{ marginTop: "var(--space-6)" }}>
      <h2 id="client-related-title" className={styles.rowTitle} style={{ marginBottom: "var(--space-3)" }}>
        {messages.title}
      </h2>

      {current === null && <div className={styles.rowSubtitle}>{messages.loading}</div>}
      {current !== null && !current.ok && <div className={styles.rowSubtitle}>{messages.error}</div>}

      {current?.ok && workGroups.length === 0 && invoices.length === 0 && (
        <div className={styles.rowSubtitle}>{messages.empty}</div>
      )}

      {workGroups.map((group) => (
        <div key={group.title} style={{ marginBottom: "var(--space-3)" }}>
          <div className={styles.rowSubtitle}>{group.title}</div>
          <div className={styles.list}>
            {group.items.map((item) => (
              <a key={item.id} className={styles.row} style={{ minHeight: 44, color: "inherit", textDecoration: "none" }} href={`/${workspaceSlug}/work`}>
                <div>
                  <div className={styles.rowTitle}>{item.title}</div>
                  <div className={styles.rowSubtitle}>{statusLabel(item.status)}</div>
                </div>
                {item.amountMinor !== undefined && item.currency && (
                  <span className={styles.rowValue}>{money(item.amountMinor, item.currency)}</span>
                )}
              </a>
            ))}
          </div>
        </div>
      ))}

      {invoices.length > 0 && (
        <div>
          <div className={styles.rowSubtitle}>{messages.invoices}</div>
          <div className={styles.list}>
            {invoices.map((inv) => (
              <a key={inv.id} className={styles.row} style={{ minHeight: 44, color: "inherit", textDecoration: "none" }} href={`/${workspaceSlug}/finance`}>
                <div>
                  <div className={styles.rowTitle}>{inv.number}</div>
                  <div className={styles.rowSubtitle}>{invoiceLabel(inv.status)}</div>
                </div>
                <span className={styles.rowValue}>{money(inv.amountMinor, inv.currency)}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
