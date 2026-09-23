"use client";

import { useState } from "react";
import { Button, Input, Sheet } from "@/components/ui";
import type { Appointment } from "@/features/appointments/types";
import { findConflicts } from "@/features/appointments/conflicts";
import { checkAvailability } from "@/features/workingHours/logic";
import type { ServiceDefinition } from "@/features/services/types";
import type { WorkingHoursProfile } from "@/features/workingHours/types";
import type { Messages } from "@/lib/i18n";
import styles from "./MoveAppointmentSheet.module.css";

export function MoveAppointmentSheet({
  open,
  onClose,
  appointment,
  allAppointments,
  services,
  workingHours,
  messages,
  conflictMessages,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  appointment: Appointment | null;
  allAppointments: Appointment[];
  services: ServiceDefinition[];
  workingHours: WorkingHoursProfile[];
  messages: Messages["move"];
  conflictMessages: Messages["conflict"];
  onConfirm: (date: string, time: string) => void;
}) {
  const [date, setDate] = useState(appointment?.date ?? "");
  const [time, setTime] = useState(appointment?.time ?? "");
  const [confirming, setConfirming] = useState(false);

  if (!appointment) return null;

  const availability = checkAvailability(appointment.staff, date, time, appointment.durationMinutes, workingHours);
  const conflict = findConflicts(
    {
      id: appointment.id,
      staff: appointment.staff,
      resourceId: appointment.resourceId,
      date,
      time,
      durationMinutes: appointment.durationMinutes,
      service: appointment.service,
    },
    allAppointments,
    services,
  );
  const blocked = !availability.available || conflict.hasConflict;

  function handleClose() {
    setConfirming(false);
    onClose();
  }

  return (
    <Sheet open={open} onClose={handleClose} title={messages.title}>
      {!confirming ? (
        <div className={styles.form}>
          <div className={styles.currentSlot}>
            <div className={styles.currentSlotLabel}>{messages.currentSlot}</div>
            {appointment.date} · {appointment.time}
          </div>

          <div className={styles.row2}>
            <Input
              label={messages.newDate}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <Input
              label={messages.newTime}
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>

          {blocked && (
            <div className={styles.warningCard}>
              {conflict.staffConflict
                ? conflictMessages.staffDescription
                    .replace("{staff}", appointment.staff)
                    .replace("{client}", conflict.staffConflict.client)
                : !availability.available
                  ? conflictMessages.outsideHoursDescription.replace("{staff}", appointment.staff)
                  : null}
            </div>
          )}

          <Button fullWidth disabled={blocked} onClick={() => setConfirming(true)}>
            {messages.confirm}
          </Button>
        </div>
      ) : (
        <div className={styles.confirmBox}>
          <p className={styles.confirmDescription}>
            {messages.confirmDescription
              .replace("{client}", appointment.client)
              .replace("{fromTime}", appointment.time)
              .replace("{toTime}", time)
              .replace("{toDate}", date)}
          </p>
          <div className={styles.confirmActions}>
            <Button variant="secondary" fullWidth onClick={() => setConfirming(false)}>
              {messages.cancel}
            </Button>
            <Button
              fullWidth
              onClick={() => {
                onConfirm(date, time);
                handleClose();
              }}
            >
              {messages.confirm}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
