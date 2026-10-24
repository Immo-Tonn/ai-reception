"use client";

import { useState } from "react";
import { getMyCalendarFeedAction, resetMyCalendarFeedAction, type MyCalendarFeed } from "@/server/actions/clientAccount.actions";
import type { Messages } from "@/lib/i18n";
import styles from "./CalendarSubscription.module.css";

/**
 * "All my bookings in my calendar": a personal, secret subscription URL that
 * Google / Apple / Outlook keep up to date (moves and cancellations included).
 * The link is only created when the client asks for it.
 */
export function CalendarSubscription({ client }: { client: Messages["client"] }) {
  const [feed, setFeed] = useState<MyCalendarFeed | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "copied" | "reset">("idle");
  const [confirmReset, setConfirmReset] = useState(false);

  async function load(reset: boolean) {
    setState("loading");
    const result = reset ? await resetMyCalendarFeedAction() : await getMyCalendarFeedAction();
    if (result.ok) {
      setFeed(result.data);
      setState(reset ? "reset" : "idle");
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

  return (
    <section className={styles.card} aria-labelledby="calendar-sync-title">
      <h2 id="calendar-sync-title" className={styles.title}>
        {client.calendarSyncTitle}
      </h2>
      <p className={styles.body}>{client.calendarSyncBody}</p>

      {!feed ? (
        <button type="button" className={styles.primary} onClick={() => void load(false)} disabled={state === "loading"}>
          {state === "loading" ? "…" : client.calendarSyncConnect}
        </button>
      ) : (
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
          {confirmReset ? (
            <div className={styles.row}>
              <span className={styles.hint}>{client.calendarSyncResetConfirm}</span>
              <button type="button" className={styles.danger} onClick={() => void load(true)} disabled={state === "loading"}>
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
          )}
        </>
      )}
      {state === "reset" ? <p className={styles.hint} role="status">{client.calendarSyncResetDone}</p> : null}
      {state === "error" ? <p className={styles.error} role="alert">{client.calendarSyncError}</p> : null}
    </section>
  );
}
