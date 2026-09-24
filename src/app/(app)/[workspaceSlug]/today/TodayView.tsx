"use client";

import type { KeyboardEvent } from "react";
import { Icon } from "@/components/ui";
import { useAppointments } from "@/features/appointments/useAppointments";
import { useInvoices } from "@/features/finance/useInvoices";
import { calculateOutstanding } from "@/features/finance/calculations";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import { resolveServiceLabel } from "@/features/services/label";
import { localIsoDate } from "@/lib/date/localIsoDate";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import styles from "./page.module.css";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Every attention/schedule row is a real link — <a> gives native Enter
 * handling, click-to-open-in-new-tab, and crawlable hrefs "for free";
 * browsers just don't fire it on Space the way they do for <button>, so
 * this one handler (shared by every row below) adds that back. */
function activateOnSpace(event: KeyboardEvent<HTMLAnchorElement>) {
  if (event.key === " ") {
    event.preventDefault();
    event.currentTarget.click();
  }
}

interface AttentionItem {
  id: string;
  text: string;
  /** Where tapping/clicking the row takes you — resolved once up front
   * (see `attentionItems` below) so new attention-item types only need
   * to add a case there, never touch the render/interaction code. */
  href: string;
}

export function TodayView({
  workspaceSlug,
  locale,
  dashboard,
}: {
  workspaceSlug: string;
  locale: Locale;
  dashboard: Messages["dashboard"];
}) {
  const { items: appointments } = useAppointments(workspaceSlug);
  const { items: invoices } = useInvoices(workspaceSlug);
  const workspaceServices = getWorkspaceConfig(workspaceSlug).services;

  const today = new Date();
  const todayIso = localIsoDate(today);

  const todayAppointments = appointments
    .filter((a) => a.date === todayIso && a.status !== "cancelled")
    .sort((a, b) => a.time.localeCompare(b.time));

  const revenueToday = todayAppointments
    .filter((a) => a.paid)
    .reduce((sum, a) => sum + a.price, 0);
  const pendingToday = todayAppointments.filter((a) => a.status === "pending");
  const outstanding = calculateOutstanding(invoices);
  const firstUnpaidInvoice = invoices.find((i) => i.status !== "paid");

  const attentionItems: AttentionItem[] = [];
  if (pendingToday.length > 0) {
    // A single unconfirmed appointment deep-links straight to Calendar's
    // Quick Actions for that exact appointment — client, service,
    // date/time, status and the Confirm/Open client actions are all
    // already there, so this opens on the specific record instead of a
    // list the user has to search again. With more than one pending
    // appointment there's no single target, so it falls back to the
    // day's list.
    const onlyPendingAppointment = pendingToday.length === 1 ? pendingToday[0] : undefined;
    attentionItems.push({
      id: "confirm",
      text: dashboard.attentionConfirm.replace("{count}", String(pendingToday.length)),
      href: onlyPendingAppointment
        ? `/${workspaceSlug}/calendar?appointment=${onlyPendingAppointment.id}&date=${onlyPendingAppointment.date}`
        : `/${workspaceSlug}/calendar`,
    });
  }
  if (firstUnpaidInvoice) {
    // No dedicated Invoice Detail route exists yet — Finance is the
    // closest existing screen, opened with the invoice pre-selected so
    // it's highlighted and scrolled into view instead of making the
    // user find it again in the list.
    attentionItems.push({
      id: "invoice",
      text: dashboard.attentionInvoice.replace("{number}", firstUnpaidInvoice.number),
      href: `/${workspaceSlug}/finance?invoice=${firstUnpaidInvoice.number.replace(/^#/, "")}`,
    });
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>{formatDate(today, locale, { dateStyle: "full" })}</p>
        <h1 className={styles.greeting}>{dashboard.greeting}</h1>
        <p className={styles.subtitle}>{dashboard.subtitle}</p>
      </header>

      <a
        href={`/${workspaceSlug}/assistant`}
        className={styles.assistantEntry}
        onKeyDown={activateOnSpace}
      >
        <span className={styles.assistantEntryIcon}>
          <Icon name="assistant" size={18} />
        </span>
        <span className={styles.assistantEntryBody}>
          <span className={styles.assistantEntryTitle}>{dashboard.askAssistant}</span>
          <span className={styles.assistantEntryHint}>{dashboard.askAssistantHint}</span>
        </span>
        <Icon name="chevronRight" size={18} />
      </a>

      <section className={styles.metrics}>
        <div className={styles.metricCard} style={{ background: "var(--tint-blue)", color: "var(--color-accent-blue)" }}>
          <span className={styles.metricLabel}>{dashboard.cardToday}</span>
          <span className={styles.metricValue}>{todayAppointments.length}</span>
          <span className={styles.metricMeta}>{dashboard.cardBookings}</span>
        </div>
        <div className={styles.metricCard} style={{ background: "var(--tint-mint)", color: "var(--color-accent-mint)" }}>
          <span className={styles.metricLabel}>{dashboard.cardRevenue}</span>
          <span className={styles.metricValue}>{formatCurrency(revenueToday, "EUR", locale)}</span>
        </div>
        <div className={styles.metricCard} style={{ background: "var(--tint-peach)", color: "var(--color-accent-peach)" }}>
          <span className={styles.metricLabel}>{dashboard.cardRequests}</span>
          <span className={styles.metricValue}>{pendingToday.length}</span>
          <span className={styles.metricMeta}>{dashboard.cardRequestsNew}</span>
        </div>
        <div className={styles.metricCard} style={{ background: "var(--tint-lavender)", color: "var(--color-accent-lavender)" }}>
          <span className={styles.metricLabel}>{dashboard.cardOutstanding}</span>
          <span className={styles.metricValue}>{formatCurrency(outstanding, "EUR", locale)}</span>
        </div>
      </section>

      {attentionItems.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{dashboard.needsAttention}</h2>
          <div className={styles.attentionList}>
            {attentionItems.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className={styles.attentionItem}
                onKeyDown={activateOnSpace}
              >
                <span className={styles.attentionLeft}>
                  <span className={styles.attentionDot} />
                  <span className={styles.attentionText}>{item.text}</span>
                </span>
                <span className={styles.attentionAction} aria-hidden="true">
                  <Icon name="chevronRight" size={16} />
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{dashboard.schedule}</h2>
        {todayAppointments.length === 0 ? (
          <div className={styles.attentionItem}>
            <span className={styles.attentionText}>{dashboard.noScheduleToday}</span>
          </div>
        ) : (
          <div className={styles.scheduleList}>
            {todayAppointments.map((item) => {
              const isPrivate = item.visibility === "private";
              return (
                <a
                  key={item.id}
                  href={`/${workspaceSlug}/calendar`}
                  className={styles.scheduleRow}
                  onKeyDown={activateOnSpace}
                >
                  <span className={styles.scheduleTime}>{item.time}</span>
                  <span
                    className={`${styles.scheduleAvatar} ${isPrivate ? styles.scheduleAvatarPrivate : ""}`}
                  >
                    {isPrivate ? "•" : initials(item.client)}
                  </span>
                  <div className={styles.scheduleBody}>
                    <p className={styles.scheduleTitle}>
                      {isPrivate ? dashboard.statusBusy : item.client}
                    </p>
                    {!isPrivate && (
                      <p className={styles.scheduleSubtitle}>
                        {resolveServiceLabel(item.service, workspaceServices, locale)}
                      </p>
                    )}
                  </div>
                  <div className={styles.scheduleMeta}>
                    <span className={styles.scheduleDuration}>{item.durationMinutes} min</span>
                    {isPrivate ? (
                      <span className={`${styles.badge} ${styles.badgePrivate}`}>
                        <Icon name="lock" size={11} />
                        {dashboard.private}
                      </span>
                    ) : (
                      <span
                        className={`${styles.badge} ${item.status === "confirmed" || item.status === "checkedIn" || item.status === "completed" ? styles.badgeConfirmed : styles.badgePending}`}
                      >
                        {item.status === "confirmed" ? dashboard.statusConfirmed : dashboard.statusPending}
                      </span>
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
