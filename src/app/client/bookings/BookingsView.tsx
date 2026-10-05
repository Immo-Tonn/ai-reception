"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, SaveStatus } from "@/components/ui";
import type { SaveState } from "@/components/ui";
import { StatusBadge } from "@/components/calendar/StatusBadge";
import {
  cancelMyBookingAction,
  claimPendingBookingsAction,
  getMyRescheduleSlotsAction,
  rescheduleMyBookingAction,
} from "@/server/actions/clientAccount.actions";
import type { AvailableSlot } from "@/features/appointments/availability";
import { uniqueSlotTimes } from "@/features/appointments/availability";
import type { MyBooking } from "@/features/clientAccount/types";
import {
  clientErrorKey,
  showZoneLabel,
  splitMyBookings,
  toAppointmentStatus,
} from "@/features/clientAccount/presentation";
import { clientAuthHref } from "@/features/clientAccount/redirect";
import { customerStaffLabel } from "@/features/staff/customerLabel";
import { ClientNav } from "@/components/layout/ClientNav/ClientNav";
import { browserTimeZone, buildDateStrip, zoneCityLabel } from "@/lib/time/dateStrip";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import styles from "./BookingsView.module.css";

export type BookingsViewState = "signed_out" | "ready";

interface Feedback {
  state: SaveState;
  text: string;
}
const IDLE: Feedback = { state: "idle", text: "" };

export function BookingsView({
  locale,
  client,
  appointmentStatus,
  state,
  bookings,
  hasPendingClaims,
  email,
}: {
  locale: Locale;
  client: Messages["client"];
  appointmentStatus: Messages["appointmentStatus"];
  state: BookingsViewState;
  bookings: MyBooking[];
  hasPendingClaims: boolean;
  email: string | null;
}) {
  const [expired, setExpired] = useState(false);
  const handleExpired = useCallback(() => setExpired(true), []);

  if (state === "signed_out" || expired) {
    return <SignedOutPrompt client={client} expired={expired} />;
  }
  return (
    <ReadyView
      locale={locale}
      client={client}
      appointmentStatus={appointmentStatus}
      bookings={bookings}
      hasPendingClaims={hasPendingClaims}
      email={email}
      onExpired={handleExpired}
    />
  );
}

function SignedOutPrompt({ client, expired }: { client: Messages["client"]; expired: boolean }) {
  return (
    <main className={styles.screen}>
      <div className={styles.body}>
        <h1 className={styles.title}>{client.signedOutTitle}</h1>
        {expired ? (
          <p className={styles.inlineError} role="alert">
            {client.errUnauthenticated}
          </p>
        ) : null}
        <div className={styles.signInPrompt}>
          <p>{client.signedOutBody}</p>
          <div className={styles.promptActions}>
            <Link href={clientAuthHref("login")} className={styles.primaryLink}>
              {client.loginLink}
            </Link>
            <Link href={clientAuthHref("signup")} className={styles.secondaryLink}>
              {client.createAccountCta}
            </Link>
          </div>
        </div>
        <p className={styles.guestNote}>{client.guestNote}</p>
        <Link href="/client" className={styles.backLink}>
          {client.backToHome}
        </Link>
      </div>
    </main>
  );
}

function ReadyView({
  locale,
  client,
  appointmentStatus,
  bookings,
  hasPendingClaims,
  email,
  onExpired,
}: {
  locale: Locale;
  client: Messages["client"];
  appointmentStatus: Messages["appointmentStatus"];
  bookings: MyBooking[];
  hasPendingClaims: boolean;
  email: string | null;
  onExpired: () => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [rescheduleTargetId, setRescheduleTargetId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(IDLE);
  const [busy, setBusy] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [browserZone, setBrowserZone] = useState<string | null>(null);
  const claimStarted = useRef(false);

  // Browser zone is only known on the client; reading it after mount keeps SSR and hydration identical.
  useEffect(() => setBrowserZone(browserTimeZone()), []);

  // Bookings made as a guest in this browser are linked once, right after sign-in.
  useEffect(() => {
    if (!hasPendingClaims || claimStarted.current) return;
    claimStarted.current = true;
    setClaiming(true);
    claimPendingBookingsAction()
      .then((result) => {
        if (!result.ok && result.code === "unauthenticated") onExpired();
      })
      .catch(() => undefined)
      .finally(() => {
        setClaiming(false);
        router.refresh();
      });
  }, [hasPendingClaims, onExpired, router]);

  const { upcoming, past } = useMemo(() => splitMyBookings(bookings), [bookings]);
  const visible = tab === "upcoming" ? upcoming : past;

  function fail(code: Parameters<typeof clientErrorKey>[0]) {
    if (code === "unauthenticated") {
      onExpired();
      return;
    }
    setFeedback({ state: "error", text: client[clientErrorKey(code)] });
  }

  async function handleCancel(id: string) {
    setBusy(true);
    setFeedback({ state: "saving", text: client.cancelling });
    try {
      const result = await cancelMyBookingAction(id);
      if (result.ok) {
        setCancelTargetId(null);
        setFeedback({ state: "saved", text: client.bookingCancelled });
        router.refresh();
      } else {
        fail(result.code);
      }
    } catch {
      fail("unknown");
    } finally {
      setBusy(false);
    }
  }

  async function handleReschedule(id: string, date: string, slot: AvailableSlot) {
    setBusy(true);
    setFeedback({ state: "saving", text: client.rescheduling });
    try {
      const result = await rescheduleMyBookingAction(id, date, slot.time, slot.staffId || null);
      if (result.ok) {
        setRescheduleTargetId(null);
        setFeedback({ state: "saved", text: client.bookingRescheduled });
        router.refresh();
      } else {
        fail(result.code);
      }
    } catch {
      fail("unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.screen}>
      <ClientNav client={client} active="bookings" />
      <div className={styles.body}>
        <h1 className={styles.title}>{client.myBookingsTitle}</h1>
        {email ? <p className={styles.signedInAs}>{client.signedInAs.replace("{name}", email)}</p> : null}
        {claiming ? (
          <p className={styles.metaLine} role="status">
            {client.claiming}
          </p>
        ) : null}

        <div className={styles.feedback}>
          <SaveStatus
            state={feedback.state}
            labels={{ unsaved: "", saving: feedback.text, saved: feedback.text }}
            error={feedback.text}
            onSavedExpire={() => setFeedback(IDLE)}
          />
        </div>

        {bookings.length > 0 ? (
          <Link href="/client/book" className={styles.bookCta}>
            {client.bookAppointmentCta}
          </Link>
        ) : null}

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upcoming"}
            className={`${styles.tab} ${tab === "upcoming" ? styles.tabActive : ""}`}
            onClick={() => setTab("upcoming")}
          >
            {client.upcomingTab}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "past"}
            className={`${styles.tab} ${tab === "past" ? styles.tabActive : ""}`}
            onClick={() => setTab("past")}
          >
            {client.pastTab}
          </button>
        </div>

        {visible.length === 0 ? (
          <div className={styles.emptyState}>
            <p>{tab === "upcoming" ? client.noUpcoming : client.noPast}</p>
            {bookings.length === 0 ? (
              <Link href="/client/book" className={styles.bookCta}>
                {client.firstBookingCta}
              </Link>
            ) : null}
          </div>
        ) : (
          <div className={styles.list}>
            {visible.map((booking) => (
              <BookingCard
                key={booking.id}
                booking={booking}
                locale={locale}
                client={client}
                appointmentStatus={appointmentStatus}
                browserZone={browserZone}
                busy={busy}
                cancelling={cancelTargetId === booking.id}
                rescheduling={rescheduleTargetId === booking.id}
                onStartCancel={() => {
                  setRescheduleTargetId(null);
                  setCancelTargetId(booking.id);
                  setFeedback(IDLE);
                }}
                onKeepBooking={() => setCancelTargetId(null)}
                onConfirmCancel={() => handleCancel(booking.id)}
                onStartReschedule={() => {
                  setCancelTargetId(null);
                  setRescheduleTargetId(booking.id);
                  setFeedback(IDLE);
                }}
                onCloseReschedule={() => setRescheduleTargetId(null)}
                onConfirmReschedule={(date, slot) => handleReschedule(booking.id, date, slot)}
                onExpired={onExpired}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function BookingCard({
  booking,
  locale,
  client,
  appointmentStatus,
  browserZone,
  busy,
  cancelling,
  rescheduling,
  onStartCancel,
  onKeepBooking,
  onConfirmCancel,
  onStartReschedule,
  onCloseReschedule,
  onConfirmReschedule,
  onExpired,
}: {
  booking: MyBooking;
  locale: Locale;
  client: Messages["client"];
  appointmentStatus: Messages["appointmentStatus"];
  browserZone: string | null;
  busy: boolean;
  cancelling: boolean;
  rescheduling: boolean;
  onStartCancel: () => void;
  onKeepBooking: () => void;
  onConfirmCancel: () => void;
  onStartReschedule: () => void;
  onCloseReschedule: () => void;
  onConfirmReschedule: (date: string, slot: AvailableSlot) => void;
  onExpired: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const zoneLabel = showZoneLabel(booking.timezone, browserZone) ? zoneCityLabel(booking.timezone) : null;
  const canAct = (booking.canCancel || booking.canReschedule) && !cancelling && !rescheduling;

  // Move focus into the panel that just opened so keyboard / screen-reader users land on it.
  useEffect(() => {
    if (cancelling || rescheduling) panelRef.current?.focus();
  }, [cancelling, rescheduling]);

  return (
    <div className={styles.card}>
      <div className={styles.cardMain}>
        <div className={styles.cardTopRow}>
          <span className={styles.businessName}>{booking.businessName}</span>
          <StatusBadge status={toAppointmentStatus(booking.status)} labels={appointmentStatus} />
        </div>
        <span className={styles.serviceName}>{booking.serviceName ?? "—"}</span>
        <span className={styles.metaLine}>
          {formatDate(new Date(booking.date + "T00:00:00"), locale, { dateStyle: "medium" })} · {booking.time}
          {zoneLabel ? ` (${zoneLabel})` : ""}
          {booking.staffName
            ? ` · ${customerStaffLabel(booking.staffName, { businessName: booking.businessName, neutralLabel: client.specialistNeutral })}`
            : ""}
        </span>
        {booking.price > 0 ? (
          <span className={styles.metaLine}>{formatCurrency(booking.price, booking.currency, locale)}</span>
        ) : null}
      </div>

      {canAct && (
        <div className={styles.actionsRow}>
          {booking.canReschedule ? (
            <button type="button" className={styles.textButton} onClick={onStartReschedule} disabled={busy}>
              {client.reschedule}
            </button>
          ) : null}
          {booking.canCancel ? (
            <button
              type="button"
              className={`${styles.textButton} ${styles.textButtonDestructive}`}
              onClick={onStartCancel}
              disabled={busy}
            >
              {client.cancelBooking}
            </button>
          ) : null}
        </div>
      )}

      {cancelling && (
        <div ref={panelRef} tabIndex={-1} className={styles.confirmPanel} role="group" aria-label={client.cancelConfirmTitle}>
          <span className={styles.panelTitle}>{client.cancelConfirmTitle}</span>
          <span className={styles.metaLine}>{client.cancelConfirmDescription}</span>
          <div className={styles.confirmActions}>
            <button type="button" className={styles.textButton} onClick={onKeepBooking} disabled={busy}>
              {client.keepBooking}
            </button>
            <button
              type="button"
              className={`${styles.textButton} ${styles.textButtonDestructive}`}
              onClick={onConfirmCancel}
              disabled={busy}
            >
              {client.confirmCancel}
            </button>
          </div>
        </div>
      )}

      {rescheduling && (
        <ReschedulePanel
          panelRef={panelRef}
          booking={booking}
          locale={locale}
          client={client}
          busy={busy}
          onClose={onCloseReschedule}
          onConfirm={onConfirmReschedule}
          onExpired={onExpired}
        />
      )}
    </div>
  );
}

function ReschedulePanel({
  panelRef,
  booking,
  locale,
  client,
  busy,
  onClose,
  onConfirm,
  onExpired,
}: {
  panelRef: React.RefObject<HTMLDivElement | null>;
  booking: MyBooking;
  locale: Locale;
  client: Messages["client"];
  busy: boolean;
  onClose: () => void;
  onConfirm: (date: string, slot: AvailableSlot) => void;
  onExpired: () => void;
}) {
  // Days are counted from the BUSINESS "today", never the browser's.
  const dateStrip = useMemo(() => buildDateStrip(new Date(), booking.timezone), [booking.timezone]);
  const [selectedDate, setSelectedDate] = useState(dateStrip[0]);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelectedTime(null);
    setError(null);
    getMyRescheduleSlotsAction(booking.id, selectedDate)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setSlots(uniqueSlotTimes(result.data));
        } else if (result.code === "unauthenticated") {
          onExpired();
        } else {
          setSlots([]);
          setError(client[clientErrorKey(result.code)]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSlots([]);
          setError(client.errUnknown);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [booking.id, selectedDate, client, onExpired]);

  const selectedSlot = slots.find((slot) => slot.time === selectedTime) ?? null;

  return (
    <div ref={panelRef} tabIndex={-1} className={styles.reschedulePanel} role="group" aria-label={client.rescheduleTitle}>
      <span className={styles.panelTitle}>{client.rescheduleTitle}</span>
      <div className={styles.dateStrip} role="group" aria-label={client.pickDay}>
        {dateStrip.map((iso) => {
          const date = new Date(iso + "T00:00:00");
          return (
            <button
              key={iso}
              type="button"
              aria-pressed={selectedDate === iso}
              className={`${styles.dateChip} ${selectedDate === iso ? styles.dateChipActive : ""}`}
              onClick={() => setSelectedDate(iso)}
            >
              <span>{date.toLocaleDateString(locale, { weekday: "short" })}</span>
              <strong>{date.getDate()}</strong>
            </button>
          );
        })}
      </div>

      {loading ? (
        <span className={styles.emptySlots} role="status">
          {client.slotsLoading}
        </span>
      ) : error ? (
        <span className={styles.inlineError} role="alert">
          {error}
        </span>
      ) : slots.length === 0 ? (
        <span className={styles.emptySlots}>{client.slotsEmpty}</span>
      ) : (
        <div className={styles.timeGrid} role="group" aria-label={client.pickTime}>
          {slots.map((slot) => (
            <button
              key={slot.time}
              type="button"
              aria-pressed={selectedTime === slot.time}
              className={`${styles.timeSlot} ${selectedTime === slot.time ? styles.timeSlotSelected : ""}`}
              onClick={() => setSelectedTime(slot.time)}
            >
              {slot.time}
            </button>
          ))}
        </div>
      )}

      <div className={styles.confirmActions}>
        <button type="button" className={styles.textButton} onClick={onClose} disabled={busy}>
          {client.keepBooking}
        </button>
        <button
          type="button"
          className={styles.textButton}
          onClick={() => selectedSlot && onConfirm(selectedDate, selectedSlot)}
          disabled={!selectedSlot || busy}
        >
          <Icon name="check" size={14} aria-hidden="true" /> {client.rescheduleConfirm}
        </button>
      </div>
    </div>
  );
}
