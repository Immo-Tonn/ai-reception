"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui";
import { getMyCalendarFeedAction, resetMyCalendarFeedAction, type MyCalendarFeed } from "@/server/actions/clientAccount.actions";
import type { Messages } from "@/lib/i18n";
import styles from "./CalendarSubscription.module.css";

/**
 * "All my bookings in my calendar": a personal, secret subscription URL that
 * Google / Apple / Outlook keep up to date (moves and cancellations included).
 *
 * Once a calendar app has fetched the link (server-side `connected`), this
 * collapses to a one-line "connected" state; the subscribe buttons only show
 * when the client asks for them ("connect another device").
 */
export function CalendarSubscription({ client }: { client: Messages["client"] }) {
  const [feed, setFeed] = useState<MyCalendarFeed | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "error" | "copied" | "reset">("idle");
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getMyCalendarFeedAction().then((result) => {
      if (cancelled) return;
      if (result.ok) setFeed(result.data);
      else setLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function reset() {
    setState("loading");
    const result = await resetMyCalendarFeedAction();
    if (result.ok) {
      setFeed(result.data);
      setExpanded(true); // the new link must be subscribed again
      setState("reset");
    } else {
      setState("error");
    }
    setConfirmReset(false);
  }

  async function copy() {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feed.url);
      setState("copied");
    } catch {
      setState("error");
    }
  }

  if (loadFailed) {
    return (
      <section className={styles.card}>
        <p className={styles.error} role="alert">
          {client.calendarSyncError}
        </p>
      </section>
    );
  }

  if (!feed) {
    return (
      <section className={styles.card} aria-busy="true">
        <p className={styles.hint}>{client.calendarSyncTitle}</p>
      </section>
    );
  }

  const options = (
    <>
      <div className={styles.row}>
        <a className={styles.button} href={feed.googleUrl} target="_blank" rel="noopener noreferrer">
          {client.calendarSyncGoogle}
        </a>
        <a className={styles.button} href={feed.webcalUrl}>
          {client.calendarSyncApple}
        </a>
        <button type="button" className={styles.button} onClick={() => void copy()}>
          {state === "copied" ? client.calendarSyncCopied : client.calendarSyncCopy}
        </button>
      </div>
      <p className={styles.hint}>{client.calendarSyncPrivacy}</p>
    </>
  );

  const resetControl = confirmReset ? (
    <div className={styles.row}>
      <span className={styles.hint}>{client.calendarSyncResetConfirm}</span>
      <button type="button" className={styles.danger} onClick={() => void reset()} disabled={state === "loading"}>
        {client.calendarSyncReset}
      </button>
      <button type="button" className={styles.link} onClick={() => setConfirmReset(false)}>
        {client.calendarSyncKeep}
      </button>
    </div>
  ) : (
    <button type="button" className={styles.link} onClick={() => setConfirmReset(true)}>
      {client.calendarSyncReset}
    </button>
  );

  // Connected: one quiet line; everything else on demand.
  if (feed.connected && state !== "reset") {
    return (
      <section className={styles.card} aria-labelledby="calendar-sync-title">
        <p id="calendar-sync-title" className={styles.connected}>
          <Icon name="check" size={16} /> {client.calendarSyncConnected}
        </p>
        {expanded ? options : null}
        <div className={styles.row}>
          {!expanded ? (
            <button type="button" className={styles.link} onClick={() => setExpanded(true)}>
              {client.calendarSyncAnotherDevice}
            </button>
          ) : null}
          {resetControl}
        </div>
        {state === "error" ? <p className={styles.error} role="alert">{client.calendarSyncError}</p> : null}
      </section>
    );
  }

  return (
    <section className={styles.card} aria-labelledby="calendar-sync-title">
      <h2 id="calendar-sync-title" className={styles.title}>
        {client.calendarSyncTitle}
      </h2>
      <p className={styles.body}>{client.calendarSyncBody}</p>
      {expanded ? (
        <>
          {options}
          {resetControl}
        </>
      ) : (
        <button type="button" className={styles.primary} onClick={() => setExpanded(true)}>
          {client.calendarSyncConnect}
        </button>
      )}
      {state === "reset" ? <p className={styles.hint} role="status">{client.calendarSyncResetDone}</p> : null}
      {state === "error" ? <p className={styles.error} role="alert">{client.calendarSyncError}</p> : null}
    </section>
  );
}
