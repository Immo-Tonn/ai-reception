"use client";

import { useMemo, useState } from "react";
import { useAppointments } from "@/features/appointments/useAppointments";
import { useInvoices } from "@/features/finance/useInvoices";
import { useLeads } from "@/features/work/useWork";
import { computeAnalytics, type AnalyticsPeriod } from "@/features/analytics/calculations";
import type { FinancialBucket } from "@/features/appointments/types";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import { localIsoDate } from "@/lib/date/localIsoDate";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency } from "@/lib/i18n/format";
import styles from "./page.module.css";

export function AnalyticsView({
  workspaceSlug,
  locale,
  messages,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["analytics"];
}) {
  const { items: appointments } = useAppointments(workspaceSlug);
  const { items: invoices } = useInvoices(workspaceSlug);
  const { items: leads } = useLeads(workspaceSlug);
  const demoServices = useMemo(() => getWorkspaceConfig(workspaceSlug).services, [workspaceSlug]);

  const [periodDays, setPeriodDays] = useState<AnalyticsPeriod>(30);
  const [service, setService] = useState<string>("all");
  const [staff, setStaff] = useState<string>("all");
  const [bucket, setBucket] = useState<FinancialBucket | "all">("all");

  const staffOptions = useMemo(
    () => Array.from(new Set(appointments.map((a) => a.staff))),
    [appointments],
  );

  const result = useMemo(
    () =>
      computeAnalytics({
        today: localIsoDate(new Date()),
        appointments,
        invoices,
        leads,
        filters: { periodDays, service, staff, bucket },
      }),
    [appointments, invoices, leads, periodDays, service, staff, bucket],
  );

  const bucketLabel: Record<FinancialBucket, string> = {
    main: messages.bucketMain,
    private: messages.bucketPrivate,
    custom: messages.bucketMain,
  };

  const maxServiceCount = result.popularServices[0]?.count ?? 0;
  const maxUtilizationMinutes = result.staffUtilization[0]?.minutes ?? 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
      </header>

      <div className={styles.filters}>
        <select
          className={styles.select}
          value={periodDays}
          onChange={(event) => setPeriodDays(Number(event.target.value) as AnalyticsPeriod)}
        >
          <option value={7}>{messages.period7}</option>
          <option value={30}>{messages.period30}</option>
          <option value={90}>{messages.period90}</option>
        </select>

        <select className={styles.select} value={bucket} onChange={(event) => setBucket(event.target.value as FinancialBucket | "all")}>
          <option value="all">{messages.bucketAll}</option>
          <option value="main">{messages.bucketMain}</option>
          <option value="private">{messages.bucketPrivate}</option>
        </select>

        <select className={styles.select} value={service} onChange={(event) => setService(event.target.value)}>
          <option value="all">{messages.filterAllOption}</option>
          {demoServices.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>

        <select className={styles.select} value={staff} onChange={(event) => setStaff(event.target.value)}>
          <option value="all">{messages.filterAllOption}</option>
          {staffOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.revenueCard}>
        <div className={styles.revenueLabel}>{messages.revenueTitle}</div>
        <div className={styles.revenueValue}>
          {formatCurrency(result.revenue.combined, result.revenue.currency, locale)}
        </div>
        <div className={styles.revenueBreakdown}>
          <span>
            <span className={styles.revenueDotMain} />
            {messages.bucketMain}: {formatCurrency(result.revenue.main, result.revenue.currency, locale)}
          </span>
          <span>
            <span className={styles.revenueDotPrivate} />
            {messages.bucketPrivate}: {formatCurrency(result.revenue.private, result.revenue.currency, locale)}
          </span>
        </div>
      </div>

      <div className={styles.summaryRow}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{messages.appointmentsTitle}</span>
          <span className={styles.summaryValue}>{result.appointmentsTotal}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{messages.completedLabel}</span>
          <span className={styles.summaryValue}>{result.completed}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{messages.cancelledLabel}</span>
          <span className={styles.summaryValue}>{result.cancelled}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{messages.noShowLabel}</span>
          <span className={styles.summaryValue}>{result.noShow}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{messages.newClientsLabel}</span>
          <span className={styles.summaryValue}>{result.newClients}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{messages.returningClientsLabel}</span>
          <span className={styles.summaryValue}>{result.returningClients}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{messages.averageTicketLabel}</span>
          <span className={styles.summaryValue}>
            {formatCurrency(result.averageTicket, result.revenue.currency, locale)}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>{messages.outstandingInvoicesTitle}</span>
          <span className={styles.summaryValue}>
            {formatCurrency(result.outstanding, result.revenue.currency, locale)}
          </span>
        </div>
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{messages.popularServicesTitle}</h2>
        {result.popularServices.length === 0 ? (
          <div className={styles.noData}>{messages.noData}</div>
        ) : (
          <div className={styles.barList}>
            {result.popularServices.map((item) => (
              <div key={item.service} className={styles.barRow}>
                <div className={styles.barLabelRow}>
                  <span>{item.service}</span>
                  <span>{item.count}</span>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{ width: `${maxServiceCount ? (item.count / maxServiceCount) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{messages.staffUtilizationTitle}</h2>
        {result.staffUtilization.length === 0 ? (
          <div className={styles.noData}>{messages.noData}</div>
        ) : (
          <div className={styles.barList}>
            {result.staffUtilization.map((item) => (
              <div key={item.staff} className={styles.barRow}>
                <div className={styles.barLabelRow}>
                  <span>{item.staff}</span>
                  <span>{item.minutes} min</span>
                </div>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{
                      width: `${maxUtilizationMinutes ? (item.minutes / maxUtilizationMinutes) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{messages.leadConversionTitle}</h2>
        <div className={styles.card}>
          {result.leadConversion.total === 0
            ? messages.noData
            : messages.leadConversionValue
                .replace("{won}", String(result.leadConversion.won))
                .replace("{total}", String(result.leadConversion.total))}
        </div>
      </div>
    </main>
  );
}
