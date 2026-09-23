import type { AppointmentStatus } from "@/features/appointments/types";
import { statusTone } from "@/features/appointments/statusMeta";
import type { Messages } from "@/lib/i18n";
import styles from "./StatusBadge.module.css";

export function StatusBadge({
  status,
  labels,
  variant = "theme",
}: {
  status: AppointmentStatus;
  labels: Messages["appointmentStatus"];
  /** "onLight" for badges drawn on the Calendar's fixed light record
   * panel, which never follows the app theme. */
  variant?: "theme" | "onLight";
}) {
  const toneClass = styles[statusTone[status]];
  return (
    <span
      className={`${styles.badge} ${toneClass} ${variant === "onLight" ? styles.onLight : ""}`}
    >
      {labels[status]}
    </span>
  );
}
