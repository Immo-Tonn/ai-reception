"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Icon, Input } from "@/components/ui";
import { getClientAvailableSlots, type AvailableSlot } from "@/features/publicBooking/availability";
import { createClientBooking, BookingUnavailableError } from "@/features/publicBooking/createBooking";
import {
  createPublicBookingAction,
  getAvailabilityAction,
  getAvailableDatesAction,
} from "@/server/actions/booking.actions";
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

const GRID_DAYS = 42;

/** Monday-first calendar grid: from this week's Monday, GRID_DAYS days. */
function buildCalendarGrid() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const offset = (today.getDay() + 6) % 7; // Monday = 0
  const start = new Date(today);
  start.setDate(today.getDate() - offset);
  return Array.from({ length: GRID_DAYS }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { iso: localIsoDate(d), day: d.getDate(), month: d.getMonth(), date: d };
  });
}

export function BookingWizard({
  workspaceSlug,
  mode,
  services,
  staffList,
  locale,
  booking,
  client,
  branding,
  youLabel,
  chromeless = false,
  headerActions,
}: {
  workspaceSlug: string;
  /** "demo" = the four demo presets (browser storage); "real" = Supabase via server actions. */
  mode: "demo" | "real";
  services: ServiceDefinition[];
  staffList: StaffMember[];
  locale: Locale;
  booking: Messages["booking"];
  client: Messages["client"];
  branding: WorkspaceBranding;
  youLabel: string;
  chromeless?: boolean;
  headerActions?: ReactNode;
}) {
  const { identity } = useClientAuth();
  const [step, setStep] = useState<Step>("service");
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null | "any">("any");
  const [selectedDate, setSelectedDate] = useState(localIsoDate(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
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
  const [touched, setTouched] = useState<{
    firstName?: boolean;
    lastName?: boolean;
    email?: boolean;
    phone?: boolean;
  }>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const firstNameFieldRef = useRef<HTMLInputElement>(null);
  const lastNameFieldRef = useRef<HTMLInputElement>(null);
  const emailFieldRef = useRef<HTMLInputElement>(null);
  const phoneFieldRef = useRef<HTMLInputElement>(null);

  const calendarGrid = useMemo(() => buildCalendarGrid(), []);
  const todayIso = localIsoDate(new Date());
  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "short" }),
      ),
    [locale],
  );
  const selectedService = services.find((s) => s.id === selectedServiceId) ?? null;
  const name = `${firstName.trim()} ${lastName.trim()}`.trim();
  const fieldErrors = useMemo(
    () => getClientDetailsFieldErrors({ name, email, phone }),
    [name, email, phone],
  );
  const firstNameInvalid = firstName.trim() === "";
  const lastNameInvalid = lastName.trim() === "" || Boolean(fieldErrors.name);
  const nameInvalid = firstNameInvalid || lastNameInvalid;
  const showFirstNameError = firstNameInvalid && (touched.firstName || submitAttempted);
  const showLastNameError = lastNameInvalid && (touched.lastName || submitAttempted);
  const showEmailError = Boolean(fieldErrors.email) && (touched.email || submitAttempted);
  const showPhoneError = Boolean(fieldErrors.phone) && (touched.phone || submitAttempted);

  // A signed-in client (see /client/login, /client/signup) doesn't have
  // to retype their details every booking — guest checkout still works
  // without ever touching this (§ booking never depends on registration).
  // Adjusts state during render when identity changes, instead of in an effect.
  const [prefilledIdentity, setPrefilledIdentity] = useState(identity);
  if (identity !== prefilledIdentity) {
    setPrefilledIdentity(identity);
    if (identity) {
      const [first, ...rest] = identity.name.split(" ");
      setFirstName((current) => current || first);
      setLastName((current) => current || rest.join(" "));
      setEmail((current) => current || identity.email);
      setPhone((current) => current || identity.phone);
    }
  }

  function eligibleStaffFor(service: ServiceDefinition | null): StaffMember[] {
    if (!service || service.allowedStaffIds.length === 0) return staffList;
    return staffList.filter((s) => service.allowedStaffIds.includes(s.id));
  }
  // The specialist step only appears when the client actually has a choice.
  const hasStaffChoice = eligibleStaffFor(selectedService).length > 1;

  // Free dates for the calendar (real workspaces): fetched once per
  // service/specialist, tagged with their request like the slots below.
  const datesKey =
    mode === "real" && step === "date" && selectedServiceId
      ? [workspaceSlug, selectedServiceId, selectedStaffId, todayIso].join("|")
      : null;
  const [datesResult, setDatesResult] = useState<{ key: string; dates: string[] } | null>(null);
  const datesLoading = datesKey !== null && datesResult?.key !== datesKey;
  const availableDates =
    datesKey !== null && datesResult?.key === datesKey ? new Set(datesResult.dates) : null;

  useEffect(() => {
    if (!datesKey || !selectedServiceId) return;
    const staffId = selectedStaffId === "any" ? null : selectedStaffId;
    getAvailableDatesAction(workspaceSlug, selectedServiceId, staffId, todayIso, GRID_DAYS)
      .then((dates) => setDatesResult({ key: datesKey, dates }))
      .catch(() => setDatesResult({ key: datesKey, dates: [] }));
  }, [datesKey, workspaceSlug, selectedServiceId, selectedStaffId, todayIso]);

  // Slots are tagged with the request they belong to, so "loading" is derived
  // from whether the latest result matches the current selection (no sync setState in an effect).
  const slotsKey =
    step === "time" && selectedServiceId
      ? [workspaceSlug, selectedServiceId, selectedStaffId, selectedDate].join("|")
      : null;
  const [slotsResult, setSlotsResult] = useState<{ key: string; slots: AvailableSlot[] } | null>(null);
  const slotsLoading = slotsKey !== null && slotsResult?.key !== slotsKey;
  const slots = slotsResult && slotsResult.key === slotsKey ? slotsResult.slots : [];

  useEffect(() => {
    if (!slotsKey || !selectedServiceId) return;
    const staffId = selectedStaffId === "any" ? null : selectedStaffId;
    const load =
      mode === "real"
        ? getAvailabilityAction(workspaceSlug, selectedServiceId, staffId, selectedDate)
        : getClientAvailableSlots(workspaceSlug, selectedServiceId, staffId, selectedDate);
    load
      .then((result) => setSlotsResult({ key: slotsKey, slots: result }))
      .catch(() => setSlotsResult({ key: slotsKey, slots: [] }));
  }, [slotsKey, mode, workspaceSlug, selectedServiceId, selectedStaffId, selectedDate]);

  // Embed resizing (§3): tell the parent page how tall we are so an
  // iframe embed can size itself instead of showing a scrollbar.
  useEffect(() => {
    if (!chromeless || typeof window === "undefined") return;
    const send = () => {
      window.parent?.postMessage(
        { type: "serviceos-booking-resize", height: document.body.scrollHeight },
        "*",
      );
    };
    send();
    const observer = new ResizeObserver(send);
    observer.observe(document.body);
    return () => observer.disconnect();
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
    if (nameInvalid || fieldErrors.email || fieldErrors.phone) {
      setSubmitAttempted(true);
      const firstInvalidRef = firstNameInvalid
        ? firstNameFieldRef
        : lastNameInvalid
          ? lastNameFieldRef
          : fieldErrors.email
            ? emailFieldRef
            : phoneFieldRef;
      firstInvalidRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setError(null);
    const staffId = selectedStaffId === "any" ? null : selectedStaffId;
    try {
      if (mode === "real") {
        const result = await createPublicBookingAction(workspaceSlug, {
          serviceId: selectedService.id,
          staffId,
          date: selectedDate,
          time: selectedSlot.time,
          client: { name, email: email.trim(), phone: phone.trim(), notes: notes.trim() },
        });
        if (!result.ok) {
          if (result.error === "unavailable") {
            setError(booking.slotTakenError);
            setStep("time");
          } else {
            setError(booking.genericError);
          }
          return;
        }
      } else {
        await createClientBooking(workspaceSlug, {
          serviceId: selectedService.id,
          staffId,
          date: selectedDate,
          time: selectedSlot.time,
          client: { name, email, phone, notes },
        });
      }
      goTo("confirmation");
    } catch (err) {
      if (!(err instanceof BookingUnavailableError)) {
        console.error("Public booking failed", err);
      }
      setError(booking.slotTakenError);
      setStep("time");
    } finally {
      setSubmitting(false);
    }
  }

  const progress = ((stepIndex(step) + 1) / steps.length) * 100;

  return (
    <div className={styles.screen}>
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
            {services.length === 0 && (
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>{booking.noSlotsTitle}</span>
              </div>
            )}
            <div className={styles.optionList}>
              {services.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  className={`${styles.optionCard} ${selectedServiceId === service.id ? styles.optionCardSelected : ""}`}
                  onClick={() => {
                    setSelectedServiceId(service.id);
                    setSelectedStaffId("any");
                    goTo(eligibleStaffFor(service).length > 1 ? "staff" : "date");
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
              {eligibleStaffFor(selectedService).map((staff) => (
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
            <button
              type="button"
              className={styles.stepBack}
              onClick={() => goTo(hasStaffChoice ? "staff" : "service")}
            >
              <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
              {hasStaffChoice ? booking.stepStaff : booking.stepService}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepDate}</h1>
            <div className={styles.calendarGrid} aria-busy={datesLoading}>
              {weekdayLabels.map((label, i) => (
                <span key={i} className={styles.calendarWeekday}>
                  {label}
                </span>
              ))}
              {calendarGrid.map((cell, index) => {
                const isPast = cell.iso < todayIso;
                const enabled = !isPast && (availableDates ? availableDates.has(cell.iso) : mode === "demo");
                const showMonth = cell.day === 1 || index === 0;
                return (
                  <button
                    key={cell.iso}
                    type="button"
                    disabled={!enabled}
                    className={`${styles.calendarDay} ${selectedDate === cell.iso ? styles.calendarDayActive : ""}`}
                    onClick={() => {
                      setSelectedDate(cell.iso);
                      goTo("time");
                    }}
                  >
                    {showMonth && (
                      <span className={styles.calendarDayMonth}>
                        {cell.date.toLocaleDateString(locale, { month: "short" })}
                      </span>
                    )}
                    {cell.day}
                  </button>
                );
              })}
            </div>
            {availableDates && availableDates.size === 0 && (
              <p className={styles.errorText}>{booking.noFreeDates}</p>
            )}
          </>
        )}

        {step === "time" && (
          <>
            <button type="button" className={styles.stepBack} onClick={() => goTo("date")}>
              <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
              {booking.stepDate}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepTime}</h1>
            {slotsLoading ? null : slots.length === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>{booking.noSlotsTitle}</span>
                {booking.noSlotsDescription}
              </div>
            ) : (
              <div className={styles.timeGrid}>
                {slots.map((slot) => (
                  <button
                    key={`${slot.time}-${slot.staffId}`}
                    type="button"
                    className={`${styles.timeSlot} ${selectedSlot?.time === slot.time && selectedSlot?.staffId === slot.staffId ? styles.timeSlotSelected : ""}`}
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
                {selectedSlot.time} · {getStaffLabel(selectedSlot.staffName, youLabel)}
              </span>
            </div>

            {error && <p className={styles.errorText}>{error}</p>}

            <div className={styles.form}>
              <Input
                ref={lastNameFieldRef}
                label={`${booking.lastNameLabel} *`}
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, lastName: true }))}
                error={showLastNameError ? booking.nameError : undefined}
                required
              />
              <Input
                ref={firstNameFieldRef}
                label={`${booking.firstNameLabel} *`}
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, firstName: true }))}
                error={showFirstNameError ? booking.nameError : undefined}
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

        {step === "confirmation" && selectedService && selectedSlot && (
          <>
            <span className={styles.confirmationIcon}>
              <Icon name="check" size={26} />
            </span>
            <h1 className={styles.stepTitle}>{booking.confirmationTitle}</h1>
            <p className={styles.confirmationDescription}>
              {booking.confirmationDescription.replace("{email}", email)}
            </p>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLine}>{getServiceLabel(selectedService, locale)}</span>
              <span className={styles.summaryLineMuted}>
                {formatDate(new Date(selectedDate + "T00:00:00"), locale, { dateStyle: "full" })} ·{" "}
                {selectedSlot.time}
              </span>
            </div>
            <Button
              fullWidth
              onClick={() => {
                setStep("service");
                setSelectedServiceId(null);
                setSelectedStaffId("any");
                setSelectedSlot(null);
                setFirstName("");
                setLastName("");
                setEmail("");
                setPhone("");
                setNotes("");
                setTouched({});
                setSubmitAttempted(false);
              }}
            >
              {booking.bookAnother}
            </Button>
            {!identity && (
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
