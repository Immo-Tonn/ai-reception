"use client";

import Link from "next/link";
import { belongsToClient } from "@/features/appointments/identity";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui";
import { useClients } from "@/features/clients/useClients";
import { useAppointments } from "@/features/appointments/useAppointments";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { useWorkspaceToday } from "@/features/workspace/WorkspaceCatalog";
import { isDemoWorkspaceSlug } from "@/features/workspace/registry";
import { StatusBadge } from "@/components/calendar/StatusBadge";
import { activeStatuses } from "@/features/appointments/statusMeta";
import { EditClientSheet } from "./EditClientSheet";
import { RelatedPanel } from "./RelatedPanel";
import styles from "./page.module.css";

type Tab = "upcoming" | "history" | "notes" | "contact";

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ClientDetailView({
  workspaceSlug,
  clientId,
  locale,
  messages,
  crossModule,
  statusMessages,
}: {
  workspaceSlug: string;
  clientId: string;
  locale: Locale;
  messages: Messages["clients"];
  crossModule: Messages["crossModule"];
  statusMessages: Messages["appointmentStatus"];
}) {
  const [tab, setTab] = useState<Tab>("upcoming");
  const [editing, setEditing] = useState(false);

  // Client, Upcoming and History are always derived live from the same
  // repository-backed hooks the rest of the app uses (ClientPicker,
  // ClientsView, CalendarView) — never a locally duplicated copy, so a
  // client created mid-session (or an appointment booked for them) shows
  // up here immediately and again after reload.
  const { items: clients, loaded: clientsLoaded, update: updateClient } = useClients(workspaceSlug);
  const { items: appointments, loaded: appointmentsLoaded } = useAppointments(workspaceSlug);

  const client = clients.find((item) => item.id === clientId) ?? null;

  const today = useWorkspaceToday(workspaceSlug);
  const clientAppointments = useMemo(
    () => (client ? appointments.filter((a) => belongsToClient(a, client)) : []),
    [appointments, client],
  );
  const upcoming = useMemo(
    () =>
      clientAppointments
        // Upcoming = still going to happen (active and today or later). Everything else is history,
        // so an appointment never disappears from the client: cancelled, no-show, completed all stay.
        .filter((a) => a.date >= today && activeStatuses.has(a.status))
        .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date))),
    [clientAppointments, today],
  );
  const history = useMemo(
    () =>
      clientAppointments
        .filter((a) => !(a.date >= today && activeStatuses.has(a.status)))
        .sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date))),
    [clientAppointments, today],
  );

  const counts = useMemo(
    () => ({
      completed: clientAppointments.filter((a) => a.status === "completed").length,
      noShow: clientAppointments.filter((a) => a.status === "noShow").length,
      cancelled: clientAppointments.filter((a) => a.status === "cancelled").length,
    }),
    [clientAppointments],
  );
  /** Opens the appointment's quick actions in the calendar (status changes / corrections live there). */
  const appointmentHref = (a: { id: string; date: string }) =>
    `/${workspaceSlug}/calendar?date=${encodeURIComponent(a.date)}&appointment=${encodeURIComponent(a.id)}`;

  const loaded = clientsLoaded && appointmentsLoaded;

  const tabs: { key: Tab; label: string }[] = [
    { key: "upcoming", label: messages.detailUpcoming },
    { key: "history", label: messages.detailHistory },
    { key: "notes", label: messages.detailNotes },
    { key: "contact", label: messages.detailContact },
  ];

  if (!loaded) return null;

  if (!client) {
    return (
      <main className={styles.page}>
        <Link className={styles.backLink} href={`/${workspaceSlug}/clients`}>
          <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
          {messages.back}
        </Link>
        <div className={styles.empty}>
          <div>{messages.notFoundTitle}</div>
          <div>{messages.notFoundDescription}</div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <Link className={styles.backLink} href={`/${workspaceSlug}/clients`}>
        <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
        {messages.back}
      </Link>

      <div className={styles.header}>
        <span className={styles.avatar}>{initials(client.name)}</span>
        <div>
          <div className={styles.name}>{client.name}</div>
          <div className={styles.tags}>
            {client.tags.includes("vip") && (
              <span className={`${styles.tag} ${styles.tagVip}`}>{messages.tagVip}</span>
            )}
            {client.tags.includes("new") && (
              <span className={`${styles.tag} ${styles.tagNew}`}>{messages.tagNew}</span>
            )}
          </div>
        </div>
        <button type="button" className={styles.editButton} onClick={() => setEditing(true)}>
          {messages.edit}
        </button>
      </div>

      <div className={styles.statusCounts} aria-label={messages.statusSummaryLabel}>
        <span>{messages.countCompleted.replace("{n}", String(counts.completed))}</span>
        <span className={counts.noShow > 0 ? styles.countWarning : undefined}>{messages.countNoShow.replace("{n}", String(counts.noShow))}</span>
        <span>{messages.countCancelled.replace("{n}", String(counts.cancelled))}</span>
      </div>

      <EditClientSheet
        key={`${client.id}-${editing}`}
        client={client}
        open={editing}
        onClose={() => setEditing(false)}
        onSave={(patch) => updateClient(client.id, patch)}
        messages={messages}
      />

      <div className={styles.tabs}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.tab} ${tab === item.key ? styles.tabActive : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "upcoming" &&
        (upcoming.length === 0 ? (
          <div className={styles.empty}>{messages.noUpcoming}</div>
        ) : (
          <div className={styles.list}>
            {upcoming.map((item) => (
              <Link key={item.id} className={styles.row} href={appointmentHref(item)}>
                <div>
                  <div className={styles.rowTitle}>{item.service}</div>
                  <div className={styles.rowSubtitle}>
                    {formatDate(new Date(item.date), locale, { dateStyle: "medium" })} · {item.time}
                  </div>
                </div>
                <StatusBadge status={item.status} labels={statusMessages} />
              </Link>
            ))}
          </div>
        ))}

      {tab === "history" &&
        (history.length === 0 ? (
          <div className={styles.empty}>{messages.noHistory}</div>
        ) : (
          <div className={styles.list}>
            {history.map((item) => (
              <Link
                key={item.id}
                className={`${styles.row} ${item.status === "cancelled" || item.status === "noShow" ? styles.rowMuted : ""}`}
                href={appointmentHref(item)}
                title={messages.historyOpenHint}
              >
                <div>
                  <div className={styles.rowTitle}>{item.service}</div>
                  <div className={styles.rowSubtitle}>
                    {formatDate(new Date(item.date), locale, { dateStyle: "medium" })} · {item.time}
                  </div>
                </div>
                <span className={styles.rowEnd}>
                  <StatusBadge status={item.status} labels={statusMessages} />
                  {item.status === "completed" ? (
                    <span className={styles.rowValue}>{formatCurrency(item.price, item.currency, locale)}</span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        ))}

      {tab === "notes" &&
        (client.notes ? (
          <div className={styles.notesBox}>{client.notes}</div>
        ) : (
          <div className={styles.empty}>{messages.noNotes}</div>
        ))}

      {tab === "contact" && (
        <div className={styles.list}>
          <div className={styles.contactRow}>
            <span className={styles.contactIcon}>
              <Icon name="mail" size={16} />
            </span>
            <span>{client.email}</span>
          </div>
          <div className={styles.contactRow}>
            <span className={styles.contactIcon}>
              <Icon name="phone" size={16} />
            </span>
            <span>{client.phone}</span>
          </div>
          {client.customFields && client.customFields.length > 0 && (
            <>
              <div className={styles.customFieldsDivider} />
              {client.customFields.map((field) => (
                <div key={field.label} className={styles.customFieldRow}>
                  <span className={styles.customFieldLabel}>{field.label}</span>
                  <span className={styles.customFieldValue}>{field.value}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {!isDemoWorkspaceSlug(workspaceSlug) && (
        <RelatedPanel workspaceSlug={workspaceSlug} clientId={client.id} locale={locale} messages={crossModule} />
      )}
    </main>
  );
}
