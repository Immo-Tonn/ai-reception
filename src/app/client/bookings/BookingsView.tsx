"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { StatusBadge } from "@/components/calendar/StatusBadge";
import { useClientAuth } from "@/features/clientAuth/useClientAuth";
import { listMyBookings, type ClientBookingRow } from "@/features/publicBooking/myBookings";
import { getClientAvailableSlots, type AvailableSlot } from "@/features/publicBooking/availability";
import { getAppointmentsRepository } from "@/features/appointments/repository";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import { resolveServiceLabel } from "@/features/services/label";
import { getStaffLabel } from "@/features/staff/label";
import { localIsoDate } from "@/lib/date/localIsoDate";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import styles from "./BookingsView.module.css";

function buildDateStrip() {
  const today = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return localIsoDate(d);
  });
}

const inactiveStatuses = new Set(["cancelled", "completed", "noShow"]);

export function BookingsView({
  locale,
  client,
  appointmentStatus,
  youLabel,
}: {
  locale: Locale;
  client: Messages["client"];
  appointmentStatus: Messages["appointmentStatus"];
  youLabel: string;
}) {
  const router = useRouter();
  const { identity, loaded: authLoaded, signOut } = useClientAuth();
  const [rows, setRows] = useState<ClientBookingRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [rescheduleTargetId, setRescheduleTargetId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    if (!identity) return;
    setRows(await listMyBookings(identity));
    setLoaded(true);
  }

  useEffect(() => {
    if (!identity) {
      setLoaded(true);
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const todayIso = localIsoDate(new Date());
  const { upcoming, past } = useMemo(() => {
    const sorted = [...rows].sort((a, b) =>
      (a.appointment.date + a.appointment.time).localeCompare(b.appointment.date + b.appointment.time),
    );
    return {
      upcoming: sorted.filter(
        (r) => r.appointment.date >= todayIso && !inactiveStatuses.has(r.appointment.status),
      ),
      past: sorted.filter(
        (r) => r.appointment.date < todayIso || inactiveStatuses.has(r.appointment.status),
      ),
    };
  }, [rows, todayIso]);

  const visible = tab === "upcoming" ? upcoming : past;

  async function handleCancel(row: ClientBookingRow) {
    await getAppointmentsRepository(row.workspaceSlug).update(row.appointment.id, { status: "cancelled" });
    setCancelTargetId(null);
    setToast(client.bookingCancelled);
    setTimeout(() => setToast(null), 2500);
    await refresh();
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  }

  if (!authLoaded || !loaded) return null;

  if (!identity) {
    return (
      <main className={styles.screen}>
        <div className={styles.body}>
          <h1 className={styles.title}>{client.myBookingsTitle}</h1>
          <div className={styles.signInPrompt}>
            <p>{client.createAccountPrompt}</p>
            <a href="/client/login?redirect=/client/bookings" className={styles.signInPromptLink}>
              {client.loginLink}
            </a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <div className={styles.topBar}>
        <span />
        <button
          type="button"
          className={styles.signOutButton}
          onClick={() => {
            signOut();
            router.push("/client");
          }}
        >
          {client.signOut}
        </button>
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{client.myBookingsTitle}</h1>
        <p className={styles.signedInAs}>{client.signedInAs.replace("{name}", identity.name || identity.email)}</p>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === "upcoming" ? styles.tabActive : ""}`}
            onClick={() => setTab("upcoming")}
          >
            {client.upcomingTab}
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === "past" ? styles.tabActive : ""}`}
            onClick={() => setTab("past")}
          >
            {client.pastTab}
          </button>
        </div>

        {visible.length === 0 ? (
          <div className={styles.emptyState}>{tab === "upcoming" ? client.noUpcoming : client.noPast}</div>
        ) : (
          <div className={styles.list}>
            {visible.map((row) => (
              <BookingCard
                key={`${row.workspaceSlug}-${row.appointment.id}`}
                row={row}
                locale={locale}
                client={client}
                appointmentStatus={appointmentStatus}
                youLabel={youLabel}
                cancelling={cancelTargetId === row.appointment.id}
                rescheduling={rescheduleTargetId === row.appointment.id}
                onStartCancel={() => setCancelTargetId(row.appointment.id)}
                onKeepBooking={() => setCancelTargetId(null)}
                onConfirmCancel={() => handleCancel(row)}
                onStartReschedule={() => setRescheduleTargetId(row.appointment.id)}
                onCloseReschedule={() => setRescheduleTargetId(null)}
                onRescheduled={async () => {
                  setRescheduleTargetId(null);
                  showToast(client.bookingRescheduled);
                  await refresh();
                }}
              />
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
    </main>
  );
}

function BookingCard({
  row,
  locale,
  client,
  appointmentStatus,
  youLabel,
  cancelling,
  rescheduling,
  onStartCancel,
  onKeepBooking,
  onConfirmCancel,
  onStartReschedule,
  onCloseReschedule,
  onRescheduled,
}: {
  row: ClientBookingRow;
  locale: Locale;
  client: Messages["client"];
  appointmentStatus: Messages["appointmentStatus"];
  youLabel: string;
  cancelling: boolean;
  rescheduling: boolean;
  onStartCancel: () => void;
  onKeepBooking: () => void;
  onConfirmCancel: () => void;
  onStartReschedule: () => void;
  onCloseReschedule: () => void;
  onRescheduled: () => void;
}) {
  const { appointment } = row;
  const workspace = getWorkspaceConfig(row.workspaceSlug);
  const canAct = !inactiveStatuses.has(appointment.status);
  const isMasked = appointment.visibility === "private";

  return (
    <div className={styles.card}>
      <div className={styles.cardMain}>
        <div className={styles.cardTopRow}>
          <span className={styles.businessName}>{row.workspaceName}</span>
          <StatusBadge status={appointment.status} labels={appointmentStatus} />
        </div>
        <span className={styles.serviceName}>
          {isMasked ? appointmentStatus[appointment.status] : resolveServiceLabel(appointment.service, workspace.services, locale)}
        </span>
        <span className={styles.metaLine}>
          {formatDate(new Date(appointment.date + "T00:00:00"), locale, { dateStyle: "medium" })} ·{" "}
          {appointment.time} · {getStaffLabel(appointment.staff, youLabel)}
        </span>
      </div>

      {canAct && !cancelling && !rescheduling && (
        <div className={styles.actionsRow}>
          <button type="button" className={styles.textButton} onClick={onStartReschedule}>
            {client.reschedule}
          </button>
          <button type="button" className={`${styles.textButton} ${styles.textButtonDestructive}`} onClick={onStartCancel}>
            {client.cancelBooking}
          </button>
        </div>
      )}

      {cancelling && (
        <div className={styles.confirmPanel}>
          <span>{client.cancelConfirmTitle}</span>
          <span className={styles.metaLine}>{client.cancelConfirmDescription}</span>
          <div className={styles.confirmActions}>
            <button type="button" className={styles.textButton} onClick={onKeepBooking}>
              {client.keepBooking}
            </button>
            <button type="button" className={`${styles.textButton} ${styles.textButtonDestructive}`} onClick={onConfirmCancel}>
              {client.confirmCancel}
            </button>
          </div>
        </div>
      )}

      {rescheduling && (
        <ReschedulePanel
          row={row}
          locale={locale}
          client={client}
          onClose={onCloseReschedule}
          onRescheduled={onRescheduled}
        />
      )}
    </div>
  );
}

function ReschedulePanel({
  row,
  locale,
  client,
  onClose,
  onRescheduled,
}: {
  row: ClientBookingRow;
  locale: Locale;
  client: Messages["client"];
  onClose: () => void;
  onRescheduled: () => void;
}) {
  const { appointment } = row;
  const dateStrip = buildDateStrip();
  const workspace = getWorkspaceConfig(row.workspaceSlug);
  const service = workspace.services.find((s) => s.name === appointment.service);
  const staffMember = workspace.staff.find((s) => s.name === appointment.staff);

  const [selectedDate, setSelectedDate] = useState(dateStrip[0]);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!service) return;
    setLoading(true);
    setSelectedSlot(null);
    getClientAvailableSlots(row.workspaceSlug, service.id, staffMember?.id ?? null, selectedDate)
      .then(setSlots)
      .finally(() => setLoading(false));
  }, [row.workspaceSlug, service, staffMember, selectedDate]);

  async function handleConfirm() {
    if (!selectedSlot) return;
    setSaving(true);
    await getAppointmentsRepository(row.workspaceSlug).update(appointment.id, {
      date: selectedDate,
      time: selectedSlot.time,
      staff: selectedSlot.staffName,
      resourceId: selectedSlot.resourceId,
    });
    setSaving(false);
    onRescheduled();
  }

  return (
    <div className={styles.reschedulePanel}>
      <span>{client.rescheduleTitle}</span>
      <div className={styles.dateStrip}>
        {dateStrip.map((iso) => {
          const date = new Date(iso + "T00:00:00");
          return (
            <button
              key={iso}
              type="button"
              className={`${styles.dateChip} ${selectedDate === iso ? styles.dateChipActive : ""}`}
              onClick={() => setSelectedDate(iso)}
            >
              <span>{date.toLocaleDateString(locale, { weekday: "short" })}</span>
              <strong>{date.getDate()}</strong>
            </button>
          );
        })}
      </div>

      {!loading && slots.length === 0 && <span className={styles.emptySlots}>—</span>}

      {!loading && slots.length > 0 && (
        <div className={styles.timeGrid}>
          {slots.map((slot) => (
            <button
              key={`${slot.time}-${slot.staffId}`}
              type="button"
              className={`${styles.timeSlot} ${selectedSlot?.time === slot.time ? styles.timeSlotSelected : ""}`}
              onClick={() => setSelectedSlot(slot)}
            >
              {slot.time}
            </button>
          ))}
        </div>
      )}

      <div className={styles.confirmActions}>
        <button type="button" className={styles.textButton} onClick={onClose}>
          {client.keepBooking}
        </button>
        <button
          type="button"
          className={styles.textButton}
          onClick={handleConfirm}
          disabled={!selectedSlot || saving}
        >
          <Icon name="check" size={14} aria-hidden="true" /> {client.rescheduleConfirm}
        </button>
      </div>
    </div>
  );
}
