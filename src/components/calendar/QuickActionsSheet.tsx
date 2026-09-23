"use client";

import { useState } from "react";
import { Button, Icon, Sheet, type IconName } from "@/components/ui";
import type { Appointment } from "@/features/appointments/types";
import type { Messages } from "@/lib/i18n";
import { StatusBadge } from "./StatusBadge";
import styles from "./QuickActionsSheet.module.css";

interface QuickActionsSheetProps {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
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
}

export function QuickActionsSheet({
  open,
  onClose,
  appointment,
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
}: QuickActionsSheetProps) {
  const [mode, setMode] = useState<"menu" | "confirmCancel" | "cancelledMatches">("menu");

  if (!appointment) return null;

  function handleClose() {
    setMode("menu");
    onClose();
  }

  const isMasked = appointment.visibility === "private";
  const canConfirm = appointment.status === "pending";
  const canCheckIn = appointment.status === "confirmed";
  const canComplete = ["confirmed", "checkedIn", "inProgress"].includes(appointment.status);
  const canCancelOrNoShow = !["cancelled", "completed", "noShow"].includes(appointment.status);

  const items: { icon: IconName; label: string; onClick: () => void; destructive?: boolean }[] = [
    { icon: "check", label: messages.edit, onClick: onEdit },
    { icon: "calendar", label: messages.move, onClick: onMove },
  ];
  if (canConfirm) items.push({ icon: "check", label: messages.confirm, onClick: () => onSetStatus("confirmed") });
  if (canCheckIn) items.push({ icon: "check", label: messages.checkIn, onClick: () => onSetStatus("checkedIn") });
  if (canComplete) items.push({ icon: "check", label: messages.complete, onClick: () => onSetStatus("completed") });
  items.push({
    icon: "receipt",
    label: appointment.paid ? messages.markUnpaid : messages.markPaid,
    onClick: onTogglePaid,
  });
  if (!isMasked) items.push({ icon: "clients", label: messages.openClient, onClick: onOpenClient });
  if (canCancelOrNoShow) {
    items.push({
      icon: "close",
      label: messages.markNoShow,
      onClick: () => onSetStatus("noShow"),
      destructive: true,
    });
    items.push({
      icon: "close",
      label: messages.cancel,
      onClick: () => setMode("confirmCancel"),
      destructive: true,
    });
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
        </>
      )}

      {mode === "confirmCancel" && (
        <div className={styles.confirmBox}>
          <p className={styles.confirmDescription}>
            {messages.cancelConfirmDescription
              .replace("{client}", isMasked ? statusMessages[appointment.status] : appointment.client)
              .replace("{service}", isMasked ? "" : appointment.service)
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
