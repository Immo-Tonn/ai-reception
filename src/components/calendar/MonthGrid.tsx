"use client";

import { localIsoDate } from "@/lib/date/localIsoDate";
import type { Appointment, AppointmentStatus } from "@/features/appointments/types";
import type { Messages } from "@/lib/i18n";
import styles from "./MonthGrid.module.css";

/** Not taking place — a day with only these gets a muted count. */
const INACTIVE = new Set<AppointmentStatus>(["cancelled", "rescheduled", "noShow"]);

function isoDate(d: Date) {
  return localIsoDate(d);
}

export function MonthGrid({
  monthAnchor,
  appointments,
  weekdaysShort,
  dashboardMessages,
  today: todayProp,
  onSelectDay,
  compact = false,
  selectedDate,
  countLabel,
}: {
  monthAnchor: string; // any ISO date within the month to display
  appointments: Appointment[];
  /** Static Sunday-first short weekday labels — see the note by
   * `weekdaysShort` in the i18n data files: Intl/`toLocaleDateString`
   * must not be used here since Node's and the browser's ICU can format
   * the same locale differently, which causes hydration mismatches. */
  weekdaysShort: readonly string[];
  dashboardMessages: Messages["dashboard"];
  /** Workspace-local today (YYYY-MM-DD); falls back to the browser date. */
  today?: string;
  onSelectDay: (date: string) => void;
  /** Phones: square cells with the number of appointments instead of text chips; the day's list is shown by the caller. */
  compact?: boolean;
  /** Highlighted day (compact mode). */
  selectedDate?: string;
  /** Screen-reader text per day, e.g. "{n} appointments". */
  countLabel?: string;
}) {
  const anchor = new Date(monthAnchor + "T00:00:00");
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const gridStart = new Date(firstOfMonth);
  gridStart.setDate(gridStart.getDate() - startOffset);

  const today = todayProp ?? isoDate(new Date());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });

  return (
    <div className={`${styles.grid} ${compact ? styles.gridCompact : ""}`}>
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
            className={`${styles.cell} ${outside ? styles.cellOutside : ""} ${iso === today ? styles.cellToday : ""} ${compact && iso === selectedDate ? styles.cellSelected : ""}`}
            onClick={() => onSelectDay(iso)}
            aria-pressed={compact ? iso === selectedDate : undefined}
            aria-label={compact && countLabel ? `${iso}: ${countLabel.replace("{n}", String(dayAppointments.length))}` : undefined}
          >
            <span className={styles.cellDate}>{d.getDate()}</span>
            {compact && dayAppointments.length > 0 ? (
              <span
                className={`${styles.count} ${dayAppointments.every((a) => INACTIVE.has(a.status)) ? styles.countMuted : ""}`}
                aria-hidden="true"
              >
                {dayAppointments.length > 99 ? "99+" : dayAppointments.length}
              </span>
            ) : null}
            {!compact && dayAppointments.slice(0, 3).map((a) => (
              <span
                key={a.id}
                className={`${styles.chip} ${a.visibility === "private" ? styles.chipMasked : ""} ${a.status === "cancelled" || a.status === "rescheduled" ? styles.chipCancelled : a.status === "noShow" ? styles.chipNoShow : ""}`}
              >
                {a.time} {a.visibility === "private" ? dashboardMessages.statusBusy : a.client}
              </span>
            ))}
            {!compact && dayAppointments.length > 3 && (
              <span className={styles.more}>+{dayAppointments.length - 3}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
