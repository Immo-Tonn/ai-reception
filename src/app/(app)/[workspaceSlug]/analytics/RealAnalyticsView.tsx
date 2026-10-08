"use client";

import { useEffect, useState } from "react";
import { getAnalyticsOverviewAction } from "@/server/actions/analytics.actions";
import type { ActionResult } from "@/server/actions/result";
import { periodRange, revenueTotalsByCurrency, type AnalyticsOverview } from "@/features/analytics/overview";
import { useWorkspaceToday } from "@/features/workspace/WorkspaceCatalog";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency } from "@/lib/i18n/format";
import { fromMinor } from "@/lib/money";
import styles from "./page.module.css";

type Period = 7 | 30 | 90;

/**
 * Analytics of a REAL workspace: numbers come from the database (SECURITY INVOKER SQL aggregate under the
 * viewer's Row Level Security), never from demo fixtures or localStorage. Sections the viewer may not read
 * are absent from the response, so they are simply not rendered (and were never sent to the browser).
 */
export function RealAnalyticsView({
  workspaceSlug,
  locale,
  messages,
  labels,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["analytics"];
  labels: Messages["crossModule"];
}) {
  const today = useWorkspaceToday(workspaceSlug);
  const [period, setPeriod] = useState<Period>(30);
  const [nonce, setNonce] = useState(0);
  const range = periodRange(today, period);
  const key = `${range.from}|${range.to}|${nonce}`;
  const [settled, setSettled] = useState<{ key: string; result: ActionResult<AnalyticsOverview> } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAnalyticsOverviewAction(workspaceSlug, { from: range.from, to: range.to })
      .then((result) => {
        if (!cancelled) setSettled({ key, result });
      })
      .catch(() => {
        if (!cancelled) setSettled({ key, result: { ok: false, code: "unknown" } });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, range.from, range.to, key]);

  const current = settled && settled.key === key ? settled.result : null;
  const money = (minor: number, currency: string) => formatCurrency(fromMinor(minor), currency, locale);
  const statusLabel = (code: string) => (labels.statuses as Record<string, string>)[code] ?? code;
  const invoiceLabel = (code: string) => (labels.invoiceStatuses as Record<string, string>)[code] ?? code;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
      </header>

      <div className={styles.filters}>
        <select
          suppressHydrationWarning
          className={styles.select}
          aria-label={messages.periodLabel}
          value={period}
          onChange={(event) => setPeriod(Number(event.target.value) as Period)}
        >
          <option value={7}>{messages.period7}</option>
          <option value={30}>{messages.period30}</option>
          <option value={90}>{messages.period90}</option>
        </select>
      </div>

      {current === null && (
        <div className={styles.state} role="status" aria-live="polite">
          {messages.loading}
        </div>
      )}

      {current !== null && !current.ok && (
        <div className={styles.state} role="alert">
          <span>{current.code === "forbidden" ? messages.forbidden : messages.errorTitle}</span>
          {current.code !== "forbidden" && (
            <button type="button" className={styles.retry} onClick={() => setNonce((n) => n + 1)}>
              {messages.errorRetry}
            </button>
          )}
        </div>
      )}

      {current !== null && current.ok && (
        <Overview data={current.data} messages={messages} money={money} statusLabel={statusLabel} invoiceLabel={invoiceLabel} />
      )}
    </main>
  );
}

function Overview({
  data,
  messages,
  money,
  statusLabel,
  invoiceLabel,
}: {
  data: AnalyticsOverview;
  messages: Messages["analytics"];
  money: (minor: number, currency: string) => string;
  statusLabel: (code: string) => string;
  invoiceLabel: (code: string) => string;
}) {
  const { appointments, finance, work } = data;
  const totals = finance ? revenueTotalsByCurrency(finance.revenue) : [];
  const maxService = appointments?.services[0]?.count ?? 0;
  const maxMinutes = Math.max(0, ...(appointments?.staff.map((s) => s.minutes) ?? [0]));
  const count = (code: string) => appointments?.byStatus[code] ?? 0;

  return (
    <>
      {finance && (
        <div className={styles.revenueCard}>
          <div className={styles.revenueLabel}>{messages.revenueTitle}</div>
          {totals.length === 0 ? (
            <div>{messages.noData}</div>
          ) : (
            totals.map((total) => {
              const rows = finance.revenue.filter((r) => r.currency === total.currency);
              const main = rows.filter((r) => r.bucket !== "private").reduce((n, r) => n + r.minor, 0);
              const priv = rows.filter((r) => r.bucket === "private").reduce((n, r) => n + r.minor, 0);
              return (
                <div key={total.currency}>
                  <div className={styles.revenueValue}>{money(total.minor, total.currency)}</div>
                  <div className={styles.revenueBreakdown}>
                    <span>
                      <span className={styles.revenueDotMain} />
                      {messages.bucketMain}: {money(main, total.currency)}
                    </span>
                    {data.permissions.privateBucket && (
                      <span>
                        <span className={styles.revenueDotPrivate} />
                        {messages.bucketPrivate}: {money(priv, total.currency)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <p className={styles.note}>{messages.revenueNote}</p>
        </div>
      )}

      {(appointments || data.newClients !== undefined || (finance && finance.outstanding.length > 0)) && (
        <div className={styles.summaryRow}>
          {appointments && (
            <>
              <Card label={messages.appointmentsTitle} value={appointments.total} />
              <Card label={messages.pendingLabel} value={count("pending")} />
              <Card label={messages.confirmedLabel} value={count("confirmed")} />
              <Card label={messages.completedLabel} value={count("completed")} />
              <Card label={messages.cancelledLabel} value={count("cancelled")} />
              <Card label={messages.noShowLabel} value={count("no_show")} />
            </>
          )}
          {data.newClients !== undefined && <Card label={messages.newClientsLabel} value={data.newClients} />}
          {finance?.outstanding.map((o) => (
            <div key={o.currency} className={styles.summaryCard}>
              <span className={styles.summaryLabel}>{messages.outstandingInvoicesTitle}</span>
              <span className={styles.summaryValue}>{money(o.minor, o.currency)}</span>
              {o.overdue > 0 && <span className={styles.summaryLabel}>{messages.overdueCount.replace("{count}", String(o.overdue))}</span>}
            </div>
          ))}
        </div>
      )}

      {appointments && (
        <>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{messages.popularServicesTitle}</h2>
            {appointments.services.length === 0 ? (
              <div className={styles.noData}>{messages.noData}</div>
            ) : (
              <div className={styles.barList}>
                {appointments.services.map((item) => (
                  <div key={item.serviceId ?? "none"} className={styles.barRow}>
                    <div className={styles.barLabelRow}>
                      <span>{item.name ?? messages.deletedService}</span>
                      <span>{item.count}</span>
                    </div>
                    <div className={styles.barTrack}>
                      <div className={styles.barFill} style={{ width: `${maxService ? (item.count / maxService) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>{messages.staffUtilizationTitle}</h2>
            {appointments.staff.length === 0 ? (
              <div className={styles.noData}>{messages.noData}</div>
            ) : (
              <div className={styles.barList}>
                {appointments.staff.map((item) => (
                  <div key={item.staffId ?? "none"} className={styles.barRow}>
                    <div className={styles.barLabelRow}>
                      <span>
                        {item.name ?? messages.unassigned}
                        {item.active === false && <span className={styles.muted}> ({messages.inactiveStaff})</span>}
                      </span>
                      <span>{item.minutes} min</span>
                    </div>
                    <div className={styles.barTrack}>
                      <div className={styles.barFill} style={{ width: `${maxMinutes ? (item.minutes / maxMinutes) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {finance && finance.invoices.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.invoicesTitle}</h2>
          <div className={styles.card}>
            {finance.invoices.map((row) => (
              <div key={`${row.status}-${row.currency}`} className={styles.listRow}>
                <span>
                  {invoiceLabel(row.status)} <span className={styles.muted}>({row.count})</span>
                </span>
                <span>{money(row.minor, row.currency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {work && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>{messages.pipelineTitle}</h2>
          <div className={styles.card}>
            {work.leads.map((r) => (
              <div key={`lead-${r.stage}`} className={styles.listRow}>
                <span>
                  {messages.leadsTitle}: {statusLabel(r.stage)}
                </span>
                <span>{r.count}</span>
              </div>
            ))}
            {work.quotes.map((r) => (
              <div key={`quote-${r.status}-${r.currency}`} className={styles.listRow}>
                <span>
                  {messages.quotesTitle}: {statusLabel(r.status)} <span className={styles.muted}>({r.count})</span>
                </span>
                <span>{money(r.minor, r.currency)}</span>
              </div>
            ))}
            {work.jobs.map((r) => (
              <div key={`job-${r.status}-${r.currency}`} className={styles.listRow}>
                <span>
                  {messages.jobsTitle}: {statusLabel(r.status)} <span className={styles.muted}>({r.count})</span>
                </span>
                <span>{money(r.minor, r.currency)}</span>
              </div>
            ))}
            {work.projects.map((r) => (
              <div key={`project-${r.status}`} className={styles.listRow}>
                <span>
                  {messages.projectsTitle}: {statusLabel(r.status)}
                </span>
                <span>{r.count}</span>
              </div>
            ))}
            {work.leads.length + work.quotes.length + work.jobs.length + work.projects.length === 0 && (
              <div className={styles.noData}>{messages.noData}</div>
            )}
          </div>
        </div>
      )}

      <p className={styles.note}>{messages.timezoneNote.replace("{tz}", data.range.timezone)}</p>
    </>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.summaryCard}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
    </div>
  );
}
