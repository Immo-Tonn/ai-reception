"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Icon, Input } from "@/components/ui";
import { uniqueSlotTimes, type AvailableSlot } from "@/features/appointments/availability";
import {
  getPublicBookingService,
  BookingUnavailableError,
  BookingRateLimitedError,
  type PublicBookingResult,
} from "@/features/publicBooking/bookingService";
import {
  EMBED_RESIZE_MESSAGE,
  parseHelloMessage,
  resolveParentOrigin,
} from "@/features/embed/messages";
import { getClientDetailsFieldErrors } from "@/features/publicBooking/detailsValidation";
import { getServiceLabel } from "@/features/services/label";
import { getStaffLabel } from "@/features/staff/label";
import { useClientAuth } from "@/features/clientAuth/useClientAuth";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { WorkspaceBranding } from "@/features/branding/types";
import { localIsoDate } from "@/lib/date/localIsoDate";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import styles from "./page.module.css";

type Step = "service" | "staff" | "date" | "time" | "details" | "confirmation";
const steps: Step[] = ["service", "staff", "date", "time", "details", "confirmation"];

function buildDateStrip() {
  const today = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return localIsoDate(d);
  });
}

export function BookingWizard({
  workspaceSlug,
  locale,
  booking,
  client,
  branding,
  youLabel,
  services,
  staffList,
  chromeless = false,
  headerActions,
}: {
  workspaceSlug: string;
  locale: Locale;
  booking: Messages["booking"];
  client: Messages["client"];
  branding: WorkspaceBranding;
  youLabel: string;
  /** Catalog of THIS workspace, loaded by the server page (demo preset or the database). */
  services: ServiceDefinition[];
  staffList: StaffMember[];
  chromeless?: boolean;
  headerActions?: ReactNode;
}) {
  const { identity } = useClientAuth();
  const [step, setStep] = useState<Step>("service");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null | "any">("any");
  const [selectedDate, setSelectedDate] = useState(localIsoDate(new Date()));
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [result, setResult] = useState<PublicBookingResult | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which fields have been interacted with (blurred) — an error only
  // shows once the person has actually left the field, or after a submit
  // attempt (`submitAttempted`), never on first render of an empty form
  // (§ validation UX: don't just disable Submit with no explanation, but
  // don't scold an untouched field either).
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean; phone?: boolean }>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const emailFieldRef = useRef<HTMLInputElement>(null);
  const phoneFieldRef = useRef<HTMLInputElement>(null);

  const dateStrip = buildDateStrip();
  const selectedService = services.find((s) => s.id === selectedServiceId) ?? null;
  const fieldErrors = useMemo(
    () => getClientDetailsFieldErrors({ name, email, phone }),
    [name, email, phone],
  );
  const showNameError = Boolean(fieldErrors.name) && (touched.name || submitAttempted);
  const showEmailError = Boolean(fieldErrors.email) && (touched.email || submitAttempted);
  const showPhoneError = Boolean(fieldErrors.phone) && (touched.phone || submitAttempted);

  // A signed-in client (see /client/login, /client/signup) doesn't have
  // to retype their details every booking — guest checkout still works
  // without ever touching this (§ booking never depends on registration).
  useEffect(() => {
    if (!identity) return;
    setName((current) => current || identity.name);
    setEmail((current) => current || identity.email);
    setPhone((current) => current || identity.phone);
  }, [identity]);

  useEffect(() => {
    if (step !== "time" || !selectedServiceId) return;
    setSlotsLoading(true);
    const staffId = selectedStaffId === "any" ? null : selectedStaffId;
    getPublicBookingService(workspaceSlug)
      .getAvailableSlots(workspaceSlug, selectedServiceId, staffId, selectedDate)
      // "Any specialist" yields one slot per free specialist per time — the
      // visitor sees each time once; the assignee is resolved at booking.
      .then((all) => setSlots(uniqueSlotTimes(all)))
      .catch((err) => {
        setSlots([]);
        if (err instanceof BookingRateLimitedError) setError(booking.rateLimitedError);
      })
      .finally(() => setSlotsLoading(false));
  }, [step, workspaceSlug, selectedServiceId, selectedStaffId, selectedDate, booking.rateLimitedError]);

  // Embed resizing (§3): tell the embedding page how tall we are so an
  // iframe embed can size itself instead of showing a scrollbar. Messages
  // go only to a known parent origin (never "*"): guessed from
  // ancestorOrigins/referrer, or learned from the parent's hello message
  // (accepted only from window.parent). See features/embed/messages.ts.
  useEffect(() => {
    if (!chromeless || typeof window === "undefined" || window.parent === window) return;
    let parentOrigin = resolveParentOrigin({
      ancestorOrigins: window.location.ancestorOrigins,
      referrer: document.referrer,
    });
    const send = () => {
      if (!parentOrigin) return;
      window.parent.postMessage(
        // Measure the wizard root, not html/body: those are `height: 100%`
        // (globals.css) and so are never shorter than the iframe itself.
        { type: EMBED_RESIZE_MESSAGE, height: rootRef.current?.offsetHeight ?? 0 },
        parentOrigin,
      );
    };
    const onMessage = (event: MessageEvent) => {
      const origin = parseHelloMessage(event, window.parent);
      if (!origin) return;
      parentOrigin = origin;
      send();
    };
    window.addEventListener("message", onMessage);
    send();
    const observer = new ResizeObserver(send);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
    };
  }, [chromeless, step]);

  function goTo(next: Step) {
    setError(null);
    setStep(next);
  }

  function stepIndex(s: Step) {
    return steps.indexOf(s);
  }

  async function handleSubmit() {
    if (!selectedService || !selectedSlot) return;
    if (fieldErrors.name || fieldErrors.email || fieldErrors.phone) {
      setSubmitAttempted(true);
      const firstInvalidRef = fieldErrors.name
        ? nameFieldRef
        : fieldErrors.email
          ? emailFieldRef
          : phoneFieldRef;
      firstInvalidRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const booked = await getPublicBookingService(workspaceSlug).createBooking(workspaceSlug, {
        serviceId: selectedService.id,
        staffId: selectedStaffId === "any" ? null : selectedStaffId,
        date: selectedDate,
        time: selectedSlot.time,
        client: { name, email, phone, notes },
      });
      setResult(booked);
      goTo("confirmation");
    } catch (err) {
      if (!(err instanceof BookingUnavailableError)) {
        // eslint-disable-next-line no-console
        console.error("Public booking failed", err);
      }
      setError(err instanceof BookingRateLimitedError ? booking.rateLimitedError : booking.slotTakenError);
      setStep("time");
    } finally {
      setSubmitting(false);
    }
  }

  const progress = ((stepIndex(step) + 1) / steps.length) * 100;

  return (
    <div ref={rootRef} className={`${styles.screen} ${chromeless ? styles.screenEmbedded : ""}`}>
      {!chromeless && (
        <header className={styles.header}>
          <span className={styles.logo} style={{ background: branding.primaryColor }}>
            {branding.logoInitial}
          </span>
          <span className={styles.businessName} title={branding.businessName}>
            {branding.businessName}
          </span>
          {headerActions && <span className={styles.headerRight}>{headerActions}</span>}
        </header>
      )}

      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{ width: `${progress}%`, background: branding.primaryColor }}
        />
      </div>

      <div className={`${styles.content} ${step === "details" ? styles.contentDetails : ""}`}>
        {step === "service" && (
          <>
            <h1 className={styles.stepTitle}>{booking.stepService}</h1>
            <div className={styles.optionList}>
              {services.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  className={`${styles.optionCard} ${selectedServiceId === service.id ? styles.optionCardSelected : ""}`}
                  onClick={() => {
                    setSelectedServiceId(service.id);
                    goTo("staff");
                  }}
                >
                  <span className={styles.optionBody}>
                    <span className={styles.optionTitle}>{getServiceLabel(service, locale)}</span>
                    <span className={styles.optionHint}>
                      {booking.durationLabel.replace("{minutes}", String(service.durationMinutes))}
                    </span>
                  </span>
                  <span className={styles.optionPrice}>
                    {formatCurrency(service.price, service.currency, locale)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === "staff" && (
          <>
            <button type="button" className={styles.stepBack} onClick={() => goTo("service")}>
              <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
              {booking.stepService}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepStaff}</h1>
            <div className={styles.optionList}>
              <button
                type="button"
                className={`${styles.optionCard} ${selectedStaffId === "any" ? styles.optionCardSelected : ""}`}
                onClick={() => {
                  setSelectedStaffId("any");
                  goTo("date");
                }}
              >
                <span className={styles.optionBody}>
                  <span className={styles.optionTitle}>{booking.anyStaff}</span>
                  <span className={styles.optionHint}>{booking.anyStaffHint}</span>
                </span>
              </button>
              {staffList
                .filter(
                  (s) =>
                    !selectedService?.allowedStaffIds.length ||
                    selectedService.allowedStaffIds.includes(s.id),
                )
                .map((staff) => (
                  <button
                    key={staff.id}
                    type="button"
                    className={`${styles.optionCard} ${selectedStaffId === staff.id ? styles.optionCardSelected : ""}`}
                    onClick={() => {
                      setSelectedStaffId(staff.id);
                      goTo("date");
                    }}
                  >
                    <span className={styles.optionBody}>
                      <span className={styles.optionTitle}>{getStaffLabel(staff.name, youLabel)}</span>
                    </span>
                  </button>
                ))}
            </div>
          </>
        )}

        {step === "date" && (
          <>
            <button type="button" className={styles.stepBack} onClick={() => goTo("staff")}>
              <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
              {booking.stepStaff}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepDate}</h1>
            <div className={styles.dateStrip}>
              {dateStrip.map((iso) => {
                const date = new Date(iso + "T00:00:00");
                return (
                  <button
                    key={iso}
                    type="button"
                    className={`${styles.dateChip} ${selectedDate === iso ? styles.dateChipActive : ""}`}
                    onClick={() => {
                      setSelectedDate(iso);
                      goTo("time");
                    }}
                  >
                    <span className={styles.dateChipWeekday}>
                      {date.toLocaleDateString(locale, { weekday: "short" })}
                    </span>
                    <span className={styles.dateChipNum}>{date.getDate()}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "time" && (
          <>
            <button type="button" className={styles.stepBack} onClick={() => goTo("date")}>
              <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
              {booking.stepDate}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepTime}</h1>
            {error && <p className={styles.errorText}>{error}</p>}
            {slotsLoading ? null : slots.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>{booking.noSlotsTitle}</span>
                {booking.noSlotsDescription}
              </div>
            ) : (
              <div className={styles.timeGrid}>
                {slots.map((slot) => (
                  <button
                    key={slot.time}
                    type="button"
                    className={`${styles.timeSlot} ${selectedSlot?.time === slot.time ? styles.timeSlotSelected : ""}`}
                    onClick={() => {
                      setSelectedSlot(slot);
                      goTo("details");
                    }}
                  >
                    {slot.time}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {step === "details" && selectedService && selectedSlot && (
          <>
            <button type="button" className={styles.stepBack} onClick={() => goTo("time")}>
              <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
              {booking.stepTime}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepDetails}</h1>
            <p className={styles.detailsHelper}>{booking.detailsHelper}</p>

            <div className={styles.summaryCard} style={{ borderLeftColor: branding.primaryColor }}>
              <span className={styles.summaryLine}>{getServiceLabel(selectedService, locale)}</span>
              <span className={styles.summaryLineMuted}>
                {formatDate(new Date(selectedDate + "T00:00:00"), locale, { dateStyle: "medium" })} ·{" "}
                {selectedSlot.time} ·{" "}
                {selectedStaffId === "any"
                  ? booking.anyStaff
                  : getStaffLabel(selectedSlot.staffName, youLabel)}
              </span>
            </div>

            {error && <p className={styles.errorText}>{error}</p>}

            <div className={styles.form}>
              <Input
                ref={nameFieldRef}
                label={`${booking.nameLabel} *`}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                error={showNameError ? booking.nameError : undefined}
                required
              />
              <Input
                ref={emailFieldRef}
                label={`${booking.emailLabel} *`}
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                error={showEmailError ? booking.emailError : undefined}
                required
              />
              <Input
                ref={phoneFieldRef}
                label={`${booking.phoneLabel} *`}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
                error={showPhoneError ? booking.phoneError : undefined}
                required
              />
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="booking-notes">
                  {booking.notesLabel}
                </label>
                <textarea
                  id="booking-notes"
                  className={styles.notesTextarea}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <span className={styles.fieldHint}>{booking.notesPlaceholder}</span>
              </div>
            </div>
          </>
        )}

        {step === "confirmation" && selectedService && result && (
          <>
            <span className={styles.confirmationIcon}>
              <Icon name="check" size={26} />
            </span>
            <h1 className={styles.stepTitle}>{booking.confirmationTitle}</h1>
            <p className={styles.confirmationDescription}>{booking.confirmationThanks}</p>
            <dl className={styles.summaryCard}>
              <div className={styles.summaryRow}>
                <dt>{booking.businessLabel}</dt>
                <dd>{branding.businessName}</dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>{booking.serviceLabel}</dt>
                <dd>{getServiceLabel(selectedService, locale)}</dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>{booking.specialistLabel}</dt>
                <dd>{getStaffLabel(result.staffName, youLabel)}</dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>{booking.dateTimeLabel}</dt>
                <dd>
                  {formatDate(new Date(result.date + "T00:00:00"), locale, { dateStyle: "full" })} ·{" "}
                  {result.time}
                </dd>
              </div>
              <div className={styles.summaryRow}>
                <dt>{booking.statusLabel}</dt>
                <dd>
                  {result.status === "confirmed" ? booking.statusConfirmed : booking.statusPending}
                </dd>
              </div>
            </dl>
            <Button
              fullWidth
              onClick={() => {
                setStep("service");
                setSelectedServiceId(null);
                setSelectedStaffId("any");
                setSelectedSlot(null);
                setResult(null);
                setName("");
                setEmail("");
                setPhone("");
                setNotes("");
                setTouched({});
                setSubmitAttempted(false);
              }}
            >
              {booking.bookAnother}
            </Button>
            {identity ? (
              <Link href="/client/bookings" className={styles.createAccountLink}>
                {booking.myBookingsLink}
              </Link>
            ) : (
              <a href={`/client/signup?redirect=/client/bookings`} className={styles.createAccountLink}>
                {client.createAccountPrompt}
              </a>
            )}
          </>
        )}
      </div>

      {step === "details" && (
        <div className={styles.footer}>
          <Button variant="secondary" className={styles.footerBack} onClick={() => goTo("time")}>
            {booking.back}
          </Button>
          <Button
            className={styles.footerNext}
            fullWidth
            disabled={submitting}
            onClick={handleSubmit}
          >
            {submitting ? booking.submitting : booking.confirmBooking}
          </Button>
        </div>
      )}

      {!chromeless && step !== "confirmation" && (
        <p className={styles.poweredBy}>{booking.poweredBy}</p>
      )}
    </div>
  );
}
