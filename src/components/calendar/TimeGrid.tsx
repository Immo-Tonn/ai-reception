"use client";

import type { Appointment } from "@/features/appointments/types";
import { getGridPlacement, gridHourLabels, GRID_ROW_COUNT } from "@/features/appointments/gridLayout";
import type { ServiceDefinition } from "@/features/services/types";
import { resolveServiceLabel } from "@/features/services/label";
import type { Locale, Messages } from "@/lib/i18n";
import { CANCELLED_LIKE } from "@/features/appointments/statusRules";
import styles from "./TimeGrid.module.css";

export interface TimeGridColumn {
  key: string;
  label: string;
  appointments: Appointment[];
}

export function TimeGrid({
  columns,
  services,
  locale,
  dashboardMessages,
  statusMessages,
  onSelect,
}: {
  columns: TimeGridColumn[];
  services: ServiceDefinition[];
  locale: Locale;
  dashboardMessages: Messages["dashboard"];
  /** When given, cancelled / no-show blocks carry their status as text. */
  statusMessages?: Messages["appointmentStatus"];
  onSelect: (appointment: Appointment) => void;
}) {
  const hours = gridHourLabels();
  const rowTemplate = `repeat(${GRID_ROW_COUNT}, minmax(26px, 1fr))`;

  return (
    <div className={styles.grid} style={{ "--column-count": columns.length } as React.CSSProperties}>
      <div className={styles.hourAxis} style={{ gridTemplateRows: `32px ${rowTemplate}` }}>
        <div />
        {hours.map((hour) => (
          <div key={hour} className={styles.hourLabel} style={{ gridRow: "span 2" }}>
            {hour}
          </div>
        ))}
      </div>

      <div className={styles.columns}>
        {columns.map((column) => {
          const { lanes, laneOf } = assignLanes(column.appointments);
          return (
          <div
            key={column.key}
            className={styles.column}
            // Explicit lanes: one per overlapping appointment at the same time (usually 1).
            style={{ gridTemplateRows: `32px ${rowTemplate}`, gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))` }}
          >
            <div className={styles.columnHeader} style={{ gridColumn: "1 / -1" }}>{column.label}</div>
            {Array.from({ length: GRID_ROW_COUNT }).map((_, index) => (
              <div key={`slot-${index}`} className={styles.slot} style={{ gridRow: index + 2, gridColumn: "1 / -1" }} />
            ))}
            {column.appointments.map((appointment) => {
              const { rowStart, rowSpan } = getGridPlacement(
                appointment.time,
                appointment.durationMinutes,
              );
              const isMasked = appointment.visibility === "private";
              const isCancelled = CANCELLED_LIKE.has(appointment.status);
              const isNoShow = appointment.status === "noShow";
              return (
                <button
                  key={appointment.id}
                  type="button"
                  className={`${styles.block} ${isMasked ? styles.blockMasked : ""} ${isCancelled ? styles.blockCancelled : ""} ${isNoShow ? styles.blockNoShow : ""}`}
                  style={{
                    gridRow: `${rowStart + 1} / span ${rowSpan}`,
                    gridColumn: laneOf.get(appointment.id) ?? 1,
                    background: isMasked ? undefined : "var(--tint-blue)",
                    color: isMasked ? undefined : "var(--color-accent-blue)",
                  }}
                  onClick={() => onSelect(appointment)}
                >
                  <span className={styles.blockTitle}>
                    {isMasked ? dashboardMessages.statusBusy : appointment.client}
                  </span>
                  <span className={styles.blockMeta}>
                    {appointment.time}
                    {!isMasked ? ` · ${resolveServiceLabel(appointment.service, services, locale)}` : ""}
                  </span>
                  {(isCancelled || isNoShow) && statusMessages ? (
                    <span className={styles.blockStatus}>{statusMessages[appointment.status]}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Lane per appointment so blocks fill the day's width and only SIMULTANEOUS
 * appointments sit side by side (greedy interval partitioning on grid rows).
 * Before, CSS auto-placement put every block into a second implicit lane next
 * to the hour lines, so days with bookings showed them at half width.
 */
export function assignLanes(appointments: Pick<Appointment, "id" | "time" | "durationMinutes">[]): {
  lanes: number;
  laneOf: Map<string, number>;
} {
  const laneOf = new Map<string, number>();
  const laneEnds: number[] = []; // last occupied row end per lane
  const placed = appointments
    .map((a) => ({ id: a.id, ...getGridPlacement(a.time, a.durationMinutes) }))
    .sort((x, y) => x.rowStart - y.rowStart || y.rowSpan - x.rowSpan);
  for (const item of placed) {
    const end = item.rowStart + item.rowSpan;
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= item.rowStart);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    laneOf.set(item.id, lane + 1);
  }
  return { lanes: Math.max(1, laneEnds.length), laneOf };
}
