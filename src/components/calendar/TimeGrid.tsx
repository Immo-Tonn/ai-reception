"use client";

import type { Appointment } from "@/features/appointments/types";
import { getGridPlacement, gridHourLabels, GRID_ROW_COUNT } from "@/features/appointments/gridLayout";
import type { Messages } from "@/lib/i18n";
import styles from "./TimeGrid.module.css";

export interface TimeGridColumn {
  key: string;
  label: string;
  appointments: Appointment[];
}

export function TimeGrid({
  columns,
  dashboardMessages,
  onSelect,
}: {
  columns: TimeGridColumn[];
  dashboardMessages: Messages["dashboard"];
  onSelect: (appointment: Appointment) => void;
}) {
  const hours = gridHourLabels();
  const rowTemplate = `repeat(${GRID_ROW_COUNT}, minmax(26px, 1fr))`;

  return (
    <div className={styles.grid}>
      <div className={styles.hourAxis} style={{ gridTemplateRows: `32px ${rowTemplate}` }}>
        <div />
        {hours.map((hour) => (
          <div key={hour} className={styles.hourLabel} style={{ gridRow: "span 2" }}>
            {hour}
          </div>
        ))}
      </div>

      <div className={styles.columns}>
        {columns.map((column) => (
          <div
            key={column.key}
            className={styles.column}
            style={{ gridTemplateRows: `32px ${rowTemplate}` }}
          >
            <div className={styles.columnHeader}>{column.label}</div>
            {Array.from({ length: GRID_ROW_COUNT }).map((_, index) => (
              <div key={`slot-${index}`} className={styles.slot} style={{ gridRow: index + 2 }} />
            ))}
            {column.appointments.map((appointment) => {
              const { rowStart, rowSpan } = getGridPlacement(
                appointment.time,
                appointment.durationMinutes,
              );
              const isMasked = appointment.visibility === "private";
              return (
                <button
                  key={appointment.id}
                  type="button"
                  className={`${styles.block} ${isMasked ? styles.blockMasked : ""}`}
                  style={{
                    gridRow: `${rowStart + 1} / span ${rowSpan}`,
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
                    {!isMasked ? ` · ${appointment.service}` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
