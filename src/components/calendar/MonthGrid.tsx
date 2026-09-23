"use client";

import { localIsoDate } from "@/lib/date/localIsoDate";
import type { Appointment } from "@/features/appointments/types";
import type { Messages } from "@/lib/i18n";
import styles from "./MonthGrid.module.css";

function isoDate(d: Date) {
  return localIsoDate(d);
}

export function MonthGrid({
  monthAnchor,
  appointments,
  weekdaysShort,
  dashboardMessages,
  onSelectDay,
}: {
  monthAnchor: string; // any ISO date within the month to display
  appointments: Appointment[];
  /** Static Sunday-first short weekday labels — see the note by
   * `weekdaysShort` in the i18n data files: Intl/`toLocaleDateString`
   * must not be used here since Node's and the browser's ICU can format
   * the same locale differently, which causes hydration mismatches. */
  weekdaysShort: readonly string[];
  dashboardMessages: Messages["dashboard"];
  onSelectDay: (date: string) => void;
}) {
  const anchor = new Date(monthAnchor + "T00:00:00");
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - startOffset);

  const today = isoDate(new Date());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  return (
    <div className={styles.grid}>
      {days.slice(0, 7).map((d) => (
        <div key={d.toISOString()} className={styles.weekdayHeader}>
          {weekdaysShort[d.getDay()]}
        </div>
      ))}
      {days.map((d) => {
        const iso = isoDate(d);
        const dayAppointments = appointments.filter((a) => a.date === iso);
        const outside = d.getMonth() !== month;
        return (
          <button
            key={iso}
            type="button"
            className={`${styles.cell} ${outside ? styles.cellOutside : ""} ${iso === today ? styles.cellToday : ""}`}
            onClick={() => onSelectDay(iso)}
          >
            <span className={styles.cellDate}>{d.getDate()}</span>
            {dayAppointments.slice(0, 3).map((a) => (
              <span
                key={a.id}
                className={`${styles.chip} ${a.visibility === "private" ? styles.chipMasked : ""}`}
              >
                {a.time} {a.visibility === "private" ? dashboardMessages.statusBusy : a.client}
              </span>
            ))}
            {dayAppointments.length > 3 && (
              <span className={styles.more}>+{dayAppointments.length - 3}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
