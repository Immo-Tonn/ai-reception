"use client";

import { useState } from "react";
import { Button, Icon, Sheet, type IconName } from "@/components/ui";
import type { Appointment } from "@/features/appointments/types";
import type { ServiceDefinition } from "@/features/services/types";
import { resolveServiceLabel } from "@/features/services/label";
import type { Locale, Messages } from "@/lib/i18n";
import { StatusBadge } from "./StatusBadge";
import { activeStatuses } from "@/features/appointments/statusMeta";
import { canTransition, hasStarted, wallNow } from "@/features/appointments/statusRules";
import styles from "./QuickActionsSheet.module.css";

interface QuickActionsSheetProps {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  services: ServiceDefinition[];
  locale: Locale;
  messages: Messages["quickActions"];
  statusMessages: Messages["appointmentStatus"];
  waitingListMatchCount: number;
  onEdit: () => void;
  onMove: () => void;
  onSetStatus: (status: Appointment["status"]) => void;
  onTogglePaid: () => void;
  onOpenClient: () => void;
  onConfirmCancel: () => void;
  onViewWaitingList: () => void;
  /** Workspace time zone (null: demo / this machine). */
  timeZone?: string | null;
}

export function QuickActionsSheet({
  open,
  onClose,
  appointment,
  services,
  locale,
  messages,
  statusMessages,
  waitingListMatchCount,
  onEdit,
  onMove,
  onSetStatus,
  onTogglePaid,
  onOpenClient,
  onConfirmCancel,
  onViewWaitingList,
  timeZone = null,
}: QuickActionsSheetProps) {
  const [mode, setMode] = useState<"menu" | "confirmCancel" | "cancelledMatches">("menu");

  if (!appointment) return null;

  function handleClose() {
    setMode("menu");
    onClose();
  }

  const isMasked = appointment.visibility === "private";
  // Same rules as the server (src/features/appointments/statusRules.ts).
  const now = wallNow(timeZone);
  const allowed = (to: Appointment["status"]) => canTransition(appointment, to, now);
  const status = appointment.status;
  const isOutcome = status === "completed" || status === "noShow" || status === "cancelled";
  const notStartedYet = !hasStarted(appointment, now) && (status === "pending" || status === "confirmed");

  const items: { icon: IconName; label: string; onClick: () => void; destructive?: boolean }[] = [
    { icon: "check", label: messages.edit, onClick: onEdit },
  ];
  // Only an upcoming active appointment can be moved.
  if (activeStatuses.has(status) && status !== "checkedIn" && status !== "inProgress") {
    items.push({ icon: "calendar", label: messages.move, onClick: onMove });
  }
  if (status === "pending" && allowed("confirmed")) items.push({ icon: "check", label: messages.confirm, onClick: () => onSetStatus("confirmed") });
  if (status !== "noShow" && allowed("checkedIn")) items.push({ icon: "check", label: messages.checkIn, onClick: () => onSetStatus("checkedIn") });
  if (!isOutcome && allowed("completed")) items.push({ icon: "check", label: messages.complete, onClick: () => onSetStatus("completed") });
  items.push({
    icon: "receipt",
    label: appointment.paid ? messages.markUnpaid : messages.markPaid,
    onClick: onTogglePaid,
  });
  if (!isMasked) items.push({ icon: "clients", label: messages.openClient, onClick: onOpenClient });
  if (!isOutcome && allowed("noShow")) {
    items.push({ icon: "close", label: messages.markNoShow, onClick: () => onSetStatus("noShow"), destructive: true });
  }
  if (allowed("cancelled") && status !== "cancelled") {
    items.push({ icon: "close", label: messages.cancel, onClick: () => setMode("confirmCancel"), destructive: true });
  }

  // Corrections of a wrong outcome (written to the audit log as "correction").
  const corrections: { label: string; to: Appointment["status"] }[] = [];
  if (status === "noShow") {
    if (allowed("completed")) corrections.push({ label: messages.correctToCompleted, to: "completed" });
    if (allowed("confirmed")) corrections.push({ label: messages.correctToConfirmed, to: "confirmed" });
  } else if (status === "completed") {
    if (allowed("noShow")) corrections.push({ label: messages.correctToNoShow, to: "noShow" });
    if (allowed("confirmed")) corrections.push({ label: messages.correctToConfirmed, to: "confirmed" });
  } else if (status === "cancelled" && allowed("confirmed")) {
    corrections.push({ label: messages.restoreCancelled, to: "confirmed" });
  }

  return (
    <Sheet open={open} onClose={handleClose} title={messages.title}>
      {mode === "menu" && (
        <>
          <div className={styles.summary}>
            <div className={styles.summaryBody}>
              <span className={styles.summaryTitle}>
                {isMasked ? statusMessages[appointment.status] : appointment.client}
              </span>
              <span className={styles.summaryMeta}>
                {appointment.date} · {appointment.time}
              </span>
            </div>
            <StatusBadge status={appointment.status} labels={statusMessages} />
          </div>

          {notStartedYet && <p className={styles.hint}>{messages.outcomeAfterStartHint}</p>}

          <div className={styles.list}>
            {items.map((item, index) => (
              <button
                key={index}
                type="button"
                className={`${styles.item} ${item.destructive ? styles.itemDestructive : ""}`}
                onClick={item.onClick}
              >
                <span className={styles.itemIcon}>
                  <Icon name={item.icon} size={16} />
                </span>
                {item.label}
              </button>
            ))}
          </div>

          {corrections.length > 0 && (
            <div className={styles.corrections}>
              <span className={styles.correctionsTitle}>{messages.correctionTitle}</span>
              {corrections.map((c) => (
                <button key={c.to} type="button" className={styles.item} onClick={() => onSetStatus(c.to)}>
                  <span className={styles.itemIcon}>
                    <Icon name="check" size={16} />
                  </span>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "confirmCancel" && (
        <div className={styles.confirmBox}>
          <p className={styles.confirmDescription}>
            {messages.cancelConfirmDescription
              .replace("{client}", isMasked ? statusMessages[appointment.status] : appointment.client)
              .replace("{service}", isMasked ? "" : resolveServiceLabel(appointment.service, services, locale))
              .replace("{time}", appointment.time)}
          </p>
          <div className={styles.confirmActions}>
            <Button variant="secondary" fullWidth onClick={() => setMode("menu")}>
              {messages.keepAppointment}
            </Button>
            <Button
              fullWidth
              onClick={() => {
                onConfirmCancel();
                if (waitingListMatchCount > 0) {
                  setMode("cancelledMatches");
                } else {
                  handleClose();
                }
              }}
            >
              {messages.cancelConfirmAction}
            </Button>
          </div>
        </div>
      )}

      {mode === "cancelledMatches" && (
        <div className={styles.confirmBox}>
          <div className={styles.waitingMatch}>
            {messages.waitingListMatch.replace("{count}", String(waitingListMatchCount))}
          </div>
          <div className={styles.confirmActions}>
            <Button variant="secondary" fullWidth onClick={handleClose}>
              {messages.close}
            </Button>
            <Button
              fullWidth
              onClick={() => {
                onViewWaitingList();
                handleClose();
              }}
            >
              {messages.viewWaitingList}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
