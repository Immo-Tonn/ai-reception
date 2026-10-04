"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { StatusBadge } from "@/components/calendar/StatusBadge";
import { Button, Input } from "@/components/ui";
import { useClientAuth } from "@/features/clientAuth/useClientAuth";
import { listMyBookings, type ClientBookingRow } from "@/features/publicBooking/myBookings";
import { getPublicBookingService } from "@/features/publicBooking/bookingService";
import type { AvailableSlot } from "@/features/appointments/availability";
import { findServiceFor } from "@/features/appointments/identity";
import { getAppointmentsRepository } from "@/features/appointments/repository";
import { getWorkspaceConfig } from "@/features/workspace/registry";
import { resolveServiceLabel } from "@/features/services/label";
import { getStaffLabel } from "@/features/staff/label";
import { buildDateStrip } from "@/lib/time/dateStrip";
import { isInactiveStatus, splitBookings } from "@/features/publicBooking/bookingTime";
import type { Locale, Messages } from "@/lib/i18n";
import { formatDate } from "@/lib/i18n/format";
import styles from "./BookingsView.module.css";


/**
 * DEMO ONLY (`/client/bookings?demo=1`): bookings made through the browser-local demo adapter,
 * matched by a locally remembered identity. Never mixed with real account bookings.
 */
export function DemoBookingsView({
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
  const { identity, loaded: authLoaded, signIn, signOut } = useClientAuth();
  const [demoEmail, setDemoEmail] = useState("");
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

  // Business wall-clock date + the business zone saved on the record (legacy
  // records without one fall back to the browser-local day).
  const { upcoming, past } = useMemo(() => {
    const flat = rows.map((r) => ({
      row: r,
      date: r.appointment.date,
      time: r.appointment.time,
      timezone: r.appointment.timezone ?? null,
      status: r.appointment.status,
    }));
    const split = splitBookings(flat, new Date());
    return { upcoming: split.upcoming.map((x) => x.row), past: split.past.map((x) => x.row) };
  }, [rows]);

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
          <h1 className={styles.title}>{client.demoBookingsTitle}</h1>
          <p className={styles.demoBanner}>{client.demoBookingsNote}</p>
          <form
            suppressHydrationWarning
            className={styles.demoForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (demoEmail.trim()) signIn({ name: demoEmail.trim().split("@")[0], email: demoEmail.trim(), phone: "" });
            }}
          >
            <Input
              label={client.emailLabel}
              type="email"
              autoComplete="email"
              required
              value={demoEmail}
              onChange={(event) => setDemoEmail(event.target.value)}
            />
            <p className={styles.metaLine}>{client.demoEmailPrompt}</p>
            <Button type="submit" fullWidth>
              {client.demoShow}
            </Button>
          </form>
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
            router.push("/client/bookings?demo=1");
          }}
        >
          {client.signOut}
        </button>
      </div>
      <div className={styles.body}>
        <h1 className={styles.title}>{client.demoBookingsTitle}</h1>
        <p className={styles.demoBanner}>{client.demoBookingsNote}</p>
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
  const canAct = !isInactiveStatus(appointment.status);
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
  const dateStrip = buildDateStrip(new Date(), appointment.timezone ?? null);
  const workspace = getWorkspaceConfig(row.workspaceSlug);
  const service = findServiceFor(appointment, workspace.services);
  const staffMember = workspace.staff.find((s) =>
    appointment.staffId ? s.id === appointment.staffId : s.name === appointment.staff,
  );

  const [selectedDate, setSelectedDate] = useState(dateStrip[0]);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!service) return;
    setLoading(true);
    setSelectedSlot(null);
    getPublicBookingService(row.workspaceSlug)
      .getAvailableSlots(row.workspaceSlug, service.id, staffMember?.id ?? null, selectedDate)
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
      staffId: selectedSlot.staffId,
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
