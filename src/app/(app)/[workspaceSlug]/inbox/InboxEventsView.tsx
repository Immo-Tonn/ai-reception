"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui";
import type { InboxEvent, InboxEventType } from "@/features/inbox/events";
import { useWorkspaceTimeZone } from "@/features/workspace/WorkspaceCatalog";
import { listInboxEventsAction, markAllInboxEventsReadAction, setInboxEventReadAction } from "@/server/actions/inbox.actions";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate, formatTime } from "@/lib/i18n/format";
import { addDays } from "@/lib/time/zonedTime";
import styles from "./page.module.css";

const typeIcon: Record<InboxEventType, IconName> = {
  booking_created: "calendar",
  booking_cancelled: "calendar",
  booking_rescheduled: "calendar",
  booking_status: "calendar",
  waiting_list: "history",
  work: "work",
  finance: "finance",
  system: "alert",
};

type TypeFilter = "all" | "created" | "cancelled" | "rescheduled" | "status" | "other";
type ReadFilter = "all" | "unread" | "read";
type SortOrder = "newest" | "oldest";

const TYPE_GROUP: Record<InboxEventType, Exclude<TypeFilter, "all">> = {
  booking_created: "created",
  booking_cancelled: "cancelled",
  booking_rescheduled: "rescheduled",
  booking_status: "status",
  waiting_list: "other",
  work: "other",
  finance: "other",
  system: "other",
};

/** DB status (snake_case) -> key of Messages["appointmentStatus"]. */
const DB_STATUS: Record<string, keyof Messages["appointmentStatus"]> = {
  pending: "pending",
  confirmed: "confirmed",
  checked_in: "checkedIn",
  in_progress: "inProgress",
  completed: "completed",
  cancelled: "cancelled",
  no_show: "noShow",
  rescheduled: "rescheduled",
};

/** "YYYY-MM-DD" of an instant in a time zone. */
function dayKey(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** Where tapping an event leads: the related Calendar / Client / module page. */
export function inboxEventHref(workspaceSlug: string, event: InboxEvent): string {
  const base = `/${workspaceSlug}`;
  if (event.entityType === "appointment" && event.entityId) {
    const startsAt = event.details?.startsAt;
    const date = startsAt ? `date=${dayKey(new Date(startsAt), event.details?.timezone ?? undefined)}&` : "";
    return `${base}/calendar?${date}appointment=${encodeURIComponent(event.entityId)}`;
  }
  if (event.type === "waiting_list") return `${base}/waiting-list`;
  if (event.type === "work") return `${base}/work`;
  if (event.type === "finance") return `${base}/finance`;
  if (event.clientId) return `${base}/clients/${event.clientId}`;
  return `${base}/inbox`;
}

function localizedTitle(event: InboxEvent, m: Messages["inbox"]): string {
  switch (event.code) {
    case "booking.created": return m.eventBookingCreated;
    case "booking.cancelled": return m.eventBookingCancelled;
    case "booking.rescheduled": return m.eventBookingRescheduled;
    case "booking.confirmed": return m.eventBookingConfirmed;
    case "booking.completed": return m.eventBookingCompleted;
    case "booking.no_show": return m.eventBookingNoShow;
    case "waiting.added": return m.eventWaitingAdded;
    default: return event.title;
  }
}

export function InboxEventsView({
  workspaceSlug,
  locale,
  messages,
  statusMessages,
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["inbox"];
  statusMessages: Messages["appointmentStatus"];
}) {
  const router = useRouter();
  const timeZone = useWorkspaceTimeZone(workspaceSlug) ?? undefined;
  const [events, setEvents] = useState<InboxEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const loaded = loadedKey === workspaceSlug;
  const load = useCallback(async () => setTick((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    void listInboxEventsAction(workspaceSlug).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setEvents(result.data.events);
        setUnread(result.data.unreadCount);
        setLoadFailed(null);
      } else {
        setLoadFailed(result.code);
      }
      setLoadedKey(workspaceSlug);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, tick]);

  async function setRead(event: InboxEvent, isRead: boolean): Promise<boolean> {
    setActionFailed(false);
    const result = await setInboxEventReadAction(workspaceSlug, event.id, isRead);
    if (!result.ok) {
      setActionFailed(true);
      return false;
    }
    await load();
    return true;
  }

  async function open(event: InboxEvent) {
    // Reading is best-effort: a viewer without edit rights can still follow the link.
    if (!event.isRead) await setRead(event, true);
    router.push(inboxEventHref(workspaceSlug, event));
  }

  async function markAll() {
    setActionFailed(false);
    const result = await markAllInboxEventsReadAction(workspaceSlug);
    if (!result.ok) setActionFailed(true);
    await load();
  }

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(locale);
    const list = events
      .filter((e) => typeFilter === "all" || TYPE_GROUP[e.type] === typeFilter)
      .filter((e) => readFilter === "all" || (readFilter === "unread" ? !e.isRead : e.isRead))
      .filter((e) => {
        if (!needle) return true;
        // Older events have no snapshot: their preview ("first name · service · time") is searched instead.
        const hay = [e.details?.clientName, e.details?.service, e.details?.staffName, e.preview].filter(Boolean).join(" ");
        return hay.toLocaleLowerCase(locale).includes(needle);
      })
      .sort((a, b) => (sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
    const byDay = new Map<string, InboxEvent[]>();
    for (const e of list) {
      const key = dayKey(new Date(e.createdAt), timeZone);
      byDay.set(key, [...(byDay.get(key) ?? []), e]);
    }
    return [...byDay.entries()];
  }, [events, query, typeFilter, readFilter, sort, timeZone, locale]);

  const today = dayKey(new Date(), timeZone);
  const yesterday = addDays(today, -1); // calendar-day arithmetic on the key itself (DST-safe)

  function dayLabel(key: string) {
    if (key === today) return messages.groupToday;
    if (key === yesterday) return messages.groupYesterday;
    return formatDate(new Date(`${key}T12:00:00Z`), locale, { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  }

  /** Appointment time in the appointment's own time zone (snapshot), else the workspace one. */
  function appointmentWhen(iso: string, tz: string | null) {
    const date = new Date(iso);
    const zone = tz ?? timeZone;
    return `${formatDate(date, locale, { weekday: "short", day: "numeric", month: "short", timeZone: zone })}, ${formatTime(date, locale, { timeStyle: "short", timeZone: zone })}`;
  }

  function statusLabel(dbStatus: string | null) {
    const key = dbStatus ? DB_STATUS[dbStatus] : undefined;
    return key ? statusMessages[key] : null;
  }

  function initiatorLabel(event: InboxEvent): string | null {
    const ini = event.details?.initiator;
    if (!ini) return null;
    if (ini.kind === "business_user") return ini.name ?? messages.initiatorTeam;
    if (ini.kind === "client_online") return messages.initiatorClientOnline;
    if (ini.kind === "system") return messages.initiatorSystem;
    return messages.initiatorUnknown;
  }

  const typeOptions: { key: TypeFilter; label: string }[] = [
    { key: "all", label: messages.filterAll },
    { key: "created", label: messages.filterCreated },
    { key: "cancelled", label: messages.filterCancelled },
    { key: "rescheduled", label: messages.filterRescheduled },
    { key: "status", label: messages.filterStatus },
    { key: "other", label: messages.filterOther },
  ];
  const readOptions: { key: ReadFilter; label: string }[] = [
    { key: "all", label: messages.filterAllStates },
    { key: "unread", label: messages.filterUnread },
    { key: "read", label: messages.filterRead },
  ];
  const filtering = query.trim() !== "" || typeFilter !== "all" || readFilter !== "all";

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{messages.title}</h1>
        {unread > 0 ? (
          <button type="button" className={styles.markAll} onClick={() => void markAll()}>
            {messages.markAllRead}
          </button>
        ) : null}
      </header>

      {actionFailed ? <p role="alert" className={styles.inlineError}>{messages.actionError}</p> : null}

      {!loaded ? (
        <p role="status" className={styles.emptyDescription}>…</p>
      ) : loadFailed ? (
        <div className={styles.empty} role="alert">
          <span className={styles.emptyTitle}>{messages.eventsLoadError}</span>
          <button type="button" className={styles.markAll} onClick={() => void load()}>{messages.eventsRetry}</button>
        </div>
      ) : events.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>{messages.eventsEmptyTitle}</span>
          <span className={styles.emptyDescription}>{messages.eventsEmptyDescription}</span>
        </div>
      ) : (
        <>
          <div className={styles.searchField}>
            <span className={styles.searchIcon} aria-hidden>
              <Icon name="search" size={18} />
            </span>
            <input
              type="search"
              suppressHydrationWarning
              className={styles.searchInput}
              placeholder={messages.eventsSearchPlaceholder}
              aria-label={messages.eventsSearchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className={styles.filterRow} role="group" aria-label={messages.filterTypeLabel}>
            {typeOptions.map((o) => (
              <button
                key={o.key}
                type="button"
                aria-pressed={typeFilter === o.key}
                className={`${styles.filterChip} ${typeFilter === o.key ? styles.filterChipActive : ""}`}
                onClick={() => setTypeFilter(o.key)}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className={styles.filterRow}>
            <div className={styles.filterGroup} role="group" aria-label={messages.filterReadLabel}>
              {readOptions.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={readFilter === o.key}
                  className={`${styles.filterChip} ${readFilter === o.key ? styles.filterChipActive : ""}`}
                  onClick={() => setReadFilter(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button type="button" className={styles.filterChip} onClick={() => setSort(sort === "newest" ? "oldest" : "newest")}>
              {sort === "newest" ? messages.sortNewest : messages.sortOldest}
            </button>
          </div>

          {groups.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyTitle}>{messages.eventsNoMatch}</span>
              {filtering ? (
                <button
                  type="button"
                  className={styles.markAll}
                  onClick={() => {
                    setQuery("");
                    setTypeFilter("all");
                    setReadFilter("all");
                  }}
                >
                  {messages.eventsResetFilters}
                </button>
              ) : null}
            </div>
          ) : (
            groups.map(([key, items]) => (
              <section key={key} className={styles.dayGroup} aria-label={dayLabel(key)}>
                <h2 className={styles.dayTitle}>{dayLabel(key)}</h2>
                <div className={styles.list}>
                  {items.map((event) => {
                    const d = event.details;
                    const moved = d?.oldStartsAt && d.startsAt && d.oldStartsAt !== d.startsAt;
                    const statusChange = d?.oldStatus ? `${statusLabel(d.oldStatus) ?? d.oldStatus} → ${statusLabel(d.status) ?? d.status}` : null;
                    const who = initiatorLabel(event);
                    const clientId = d?.clientId ?? event.clientId;
                    return (
                      <article key={event.id} className={`${styles.eventCard} ${event.isRead ? "" : styles.eventCardUnread}`}>
                        <button type="button" className={styles.eventMain} onClick={() => void open(event)}>
                          <span className={styles.avatar}>
                            <Icon name={typeIcon[event.type]} size={18} />
                          </span>
                          <span className={styles.body}>
                            <span className={`${styles.name} ${event.isRead ? "" : styles.nameUnread}`}>{localizedTitle(event, messages)}</span>
                            {d ? (
                              <dl className={styles.facts}>
                                {d.isPrivate ? (
                                  <div><dt>{messages.fieldClient}</dt><dd>{messages.privateAppointment}</dd></div>
                                ) : d.clientName ? (
                                  <div><dt>{messages.fieldClient}</dt><dd>{d.clientName}</dd></div>
                                ) : null}
                                {d.service ? <div><dt>{messages.fieldService}</dt><dd>{d.service}</dd></div> : null}
                                {d.staffName ? <div><dt>{messages.fieldStaff}</dt><dd>{d.staffName}</dd></div> : null}
                                {moved ? (
                                  <>
                                    <div><dt>{messages.fieldWas}</dt><dd className={styles.factOld}>{appointmentWhen(d.oldStartsAt!, d.timezone)}</dd></div>
                                    <div><dt>{messages.fieldNow}</dt><dd>{appointmentWhen(d.startsAt!, d.timezone)}</dd></div>
                                  </>
                                ) : d.startsAt ? (
                                  <div><dt>{messages.fieldAppointmentAt}</dt><dd>{appointmentWhen(d.startsAt, d.timezone)}</dd></div>
                                ) : null}
                                {statusChange ? <div><dt>{messages.fieldStatus}</dt><dd>{statusChange}</dd></div> : null}
                                {who ? <div><dt>{messages.fieldBy}</dt><dd>{who}</dd></div> : null}
                              </dl>
                            ) : event.preview ? (
                              <span className={styles.preview}>
                                {event.entityType === "appointment" ? `${messages.legacyPreviewLabel}: ` : ""}
                                {event.preview}
                              </span>
                            ) : null}
                          </span>
                          <span className={styles.meta}>
                            <span className={styles.time} title={messages.fieldChangedAt}>
                              {formatTime(new Date(event.createdAt), locale, { timeStyle: "short", timeZone })}
                            </span>
                            {event.isRead ? null : <span className={styles.unreadDot} aria-label={messages.unreadBadge} />}
                          </span>
                        </button>
                        <div className={styles.eventActions}>
                          {event.entityType === "appointment" && event.entityId ? (
                            <Link className={styles.eventLink} href={inboxEventHref(workspaceSlug, event)}>{messages.openAppointment}</Link>
                          ) : null}
                          {clientId ? (
                            <Link className={styles.eventLink} href={`/${workspaceSlug}/clients/${clientId}`}>{messages.openClient}</Link>
                          ) : null}
                          <button type="button" className={styles.eventToggle} onClick={() => void setRead(event, !event.isRead)}>
                            {event.isRead ? messages.markUnread : messages.markRead}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </>
      )}
    </main>
  );
}
