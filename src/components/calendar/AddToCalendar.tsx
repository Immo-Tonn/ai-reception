"use client";

import { buildIcsCalendar, googleCalendarEventUrl, type IcsEvent } from "@/features/calendarExport/ics";
import styles from "./AddToCalendar.module.css";

export interface AddToCalendarLabels {
  title: string;
  google: string;
  appleOutlook: string;
}

/**
 * "Add this booking to my calendar" for clients. No account, no keys:
 * Google opens with the event pre-filled; Apple / Outlook get a standard
 * .ics file. ServiceOS stores nothing.
 */
export function AddToCalendar({ event, labels }: { event: IcsEvent; labels: AddToCalendarLabels }) {
  function downloadIcs() {
    const blob = new Blob([buildIcsCalendar([event])], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "termin.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className={styles.wrap} role="group" aria-label={labels.title}>
      <span className={styles.title}>{labels.title}</span>
      <div className={styles.row}>
        <a className={styles.button} href={googleCalendarEventUrl(event)} target="_blank" rel="noopener noreferrer">
          {labels.google}
        </a>
        <button type="button" className={styles.button} onClick={downloadIcs}>
          {labels.appleOutlook}
        </button>
      </div>
    </div>
  );
}
