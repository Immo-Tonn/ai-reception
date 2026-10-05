"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui";
import type { InboxEvent, InboxEventType } from "@/features/inbox/events";
import { useWorkspaceTimeZone } from "@/features/workspace/WorkspaceCatalog";
import { listInboxEventsAction, markAllInboxEventsReadAction, setInboxEventReadAction } from "@/server/actions/inbox.actions";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate, formatTime } from "@/lib/i18n/format";
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

/** Where tapping an event leads: the related Calendar / Client / module page. */
export function inboxEventHref(workspaceSlug: string, event: InboxEvent): string {
  const base = `/${workspaceSlug}`;
  if (event.entityType === "appointment" && event.entityId) return `${base}/calendar?appointment=${encodeURIComponent(event.entityId)}`;
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
}: {
  workspaceSlug: string;
  locale: Locale;
  messages: Messages["inbox"];
}) {
  const router = useRouter();
  const timeZone = useWorkspaceTimeZone(workspaceSlug) ?? undefined;
  const [events, setEvents] = useState<InboxEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const [tick, setTick] = useState(0);
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

  function formatWhen(iso: string) {
    const date = new Date(iso);
    const sameDay =
      new Intl.DateTimeFormat("en-CA", { timeZone }).format(date) === new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
    return sameDay
      ? formatTime(date, locale, { timeStyle: "short", timeZone })
      : formatDate(date, locale, { month: "short", day: "numeric", timeZone });
  }

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
        <div className={styles.list}>
          {events.map((event) => (
            <div key={event.id} className={styles.eventRow}>
              <button type="button" className={styles.eventMain} onClick={() => void open(event)}>
                <span className={styles.avatar}>
                  <Icon name={typeIcon[event.type]} size={18} />
                </span>
                <span className={styles.body}>
                  <span className={`${styles.name} ${event.isRead ? "" : styles.nameUnread}`}>{localizedTitle(event, messages)}</span>
                  {event.preview ? <span className={styles.preview}>{event.preview}</span> : null}
                </span>
                <span className={styles.meta}>
                  <span className={styles.time}>{formatWhen(event.createdAt)}</span>
                  {event.isRead ? null : <span className={styles.unreadDot} aria-label={messages.unreadBadge} />}
                </span>
              </button>
              {event.isRead ? (
                <button type="button" className={styles.eventToggle} onClick={() => void setRead(event, false)}>
                  {messages.markUnread}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
