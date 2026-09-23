"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui";
import { useClients } from "@/features/clients/useClients";
import { useAppointments } from "@/features/appointments/useAppointments";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { localIsoDate } from "@/lib/date/localIsoDate";
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
}: {
  workspaceSlug: string;
  clientId: string;
  locale: Locale;
  messages: Messages["clients"];
}) {
  const [tab, setTab] = useState<Tab>("upcoming");

  // Client, Upcoming and History are always derived live from the same
  // repository-backed hooks the rest of the app uses (ClientPicker,
  // ClientsView, CalendarView) — never a locally duplicated copy, so a
  // client created mid-session (or an appointment booked for them) shows
  // up here immediately and again after reload.
  const { items: clients, loaded: clientsLoaded } = useClients(workspaceSlug);
  const { items: appointments, loaded: appointmentsLoaded } = useAppointments(workspaceSlug);

  const client = clients.find((item) => item.id === clientId) ?? null;

  const today = localIsoDate(new Date());
  const clientAppointments = useMemo(
    () => (client ? appointments.filter((a) => a.client === client.name) : []),
    [appointments, client],
  );
  const upcoming = useMemo(
    () =>
      clientAppointments
        .filter((a) => a.date >= today && a.status !== "cancelled")
        .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date))),
    [clientAppointments, today],
  );
  const history = useMemo(
    () =>
      clientAppointments
        .filter((a) => a.date < today || a.status === "completed" || a.status === "cancelled")
        .sort((a, b) => (a.date === b.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date))),
    [clientAppointments, today],
  );

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
        <a className={styles.backLink} href={`/${workspaceSlug}/clients`}>
          <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
          {messages.back}
        </a>
        <div className={styles.empty}>
          <div>{messages.notFoundTitle}</div>
          <div>{messages.notFoundDescription}</div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <a className={styles.backLink} href={`/${workspaceSlug}/clients`}>
        <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
        {messages.back}
      </a>

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
      </div>

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
              <div key={item.id} className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>{item.service}</div>
                  <div className={styles.rowSubtitle}>
                    {formatDate(new Date(item.date), locale, { dateStyle: "medium" })} · {item.time}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === "history" &&
        (history.length === 0 ? (
          <div className={styles.empty}>{messages.noHistory}</div>
        ) : (
          <div className={styles.list}>
            {history.map((item) => (
              <div key={item.id} className={styles.row}>
                <div>
                  <div className={styles.rowTitle}>{item.service}</div>
                  <div className={styles.rowSubtitle}>
                    {formatDate(new Date(item.date), locale, { dateStyle: "medium" })}
                  </div>
                </div>
                <span className={styles.rowValue}>
                  {formatCurrency(item.price, item.currency, locale)}
                </span>
              </div>
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
    </main>
  );
}
