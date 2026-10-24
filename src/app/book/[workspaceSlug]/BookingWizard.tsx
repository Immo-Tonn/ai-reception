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
import { customerStaffLabel } from "@/features/staff/customerLabel";
import { useClientAuth } from "@/features/clientAuth/useClientAuth";
import { clientAuthHref } from "@/features/clientAccount/redirect";
import type { ServiceDefinition } from "@/features/services/types";
import type { StaffMember } from "@/features/staff/types";
import type { WorkspaceBranding } from "@/features/branding/types";
import type { PublicProfile } from "@/server/booking/publicBooking.service";
import { browserTimeZone, buildDateStrip, zoneCityLabel } from "@/lib/time/dateStrip";
import { resolveToday } from "@/lib/time/zonedTime";
import type { Locale, Messages } from "@/lib/i18n";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import styles from "./page.module.css";
import { useClientValue } from "@/lib/hooks/useClientValue";
import { AddToCalendar } from "@/components/calendar/AddToCalendar";
import { wallToInstant } from "@/lib/time/zonedTime";

const DATE_STRIP_DAYS = 28;

type Step = "service" | "staff" | "date" | "time" | "details" | "confirmation";
const steps: Step[] = ["service", "staff", "date", "time", "details", "confirmation"];

export function BookingWizard({
  workspaceSlug,
  locale,
  booking,
  client,
  branding,
  profile,
  timezone = null,
  backToBusinessesHref = null,
  calendarConnected = false,
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
  profile?: PublicProfile;
  /** Business IANA zone; null (demo presets) keeps browser-local "today". */
  timezone?: string | null;
  /** Set when the visitor came from the ServiceOS business list (never for a business's own shared link). */
  backToBusinessesHref?: string | null;
  /** Signed-in client whose own calendar already subscribes to their bookings. */
  calendarConnected?: boolean;
  /** Catalog of THIS workspace, loaded by the server page (demo preset or the database). */
  services: ServiceDefinition[];
  staffList: StaffMember[];
  chromeless?: boolean;
  headerActions?: ReactNode;
}) {
  const { identity } = useClientAuth();
  const [step, setStep] = useState<Step>("service");
  // Bumped on every step change: entering the date / time step always asks the server again
  // (free times change), exactly like before.
  const [stepVisit, setStepVisit] = useState(0);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null | "any">("any");
  const [selectedDate, setSelectedDate] = useState(() => resolveToday(new Date(), timezone));
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [result, setResult] = useState<PublicBookingResult | null>(null);
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

  const dateStrip = useMemo(() => buildDateStrip(new Date(), timezone, { maxDaysAhead: DATE_STRIP_DAYS - 1 }), [timezone]);
  // Days that really have slots (server-computed with the same engine as the time step).
  // null = not known yet / could not be determined: every day stays selectable then.
  // Each answer is stored WITH the request it belongs to, so "loading" is derived (no setState
  // in an effect) and a late answer for an older request can never overwrite a newer one.
  const datesRequest =
    step === "date" && selectedServiceId
      ? `${stepVisit}|${selectedServiceId}|${selectedStaffId}|${dateStrip[0]}|${dateStrip.length}`
      : null;
  const [datesAnswer, setDatesAnswer] = useState<{ request: string; dates: Set<string> | null } | null>(null);
  const datesLoading = datesRequest !== null && datesAnswer?.request !== datesRequest;
  const availableDates = datesAnswer && datesAnswer.request === datesRequest ? datesAnswer.dates : null;
  // Slots and booked times are the business's wall clock. Say so when the
  // visitor's own zone differs (detected after mount to keep SSR stable).
  const visitorZone = useClientValue(browserTimeZone, null);
  const zoneNote =
    timezone && visitorZone && visitorZone !== timezone
      ? booking.timesInBusinessZone.replace("{city}", zoneCityLabel(timezone)).replace("{zone}", timezone)
      : null;
  // Customer-facing specialist name: the internal "You" placeholder never reaches a client.
  const staffLabel = (name: string) =>
    customerStaffLabel(name, { businessName: branding.businessName, neutralLabel: client.specialistNeutral });
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
  // Adjusted during render when the identity changes (React's pattern for "state from a prop").
  const [prefilledFrom, setPrefilledFrom] = useState<typeof identity>(null);
  if (identity && identity !== prefilledFrom) {
    setPrefilledFrom(identity);
    setName((current) => current || identity.name);
    setEmail((current) => current || identity.email);
    setPhone((current) => current || identity.phone);
  }

  useEffect(() => {
    if (!datesRequest || !selectedServiceId) return;
    let cancelled = false;
    const staffId = selectedStaffId === "any" ? null : selectedStaffId;
    getPublicBookingService(workspaceSlug)
      .getAvailableDates(workspaceSlug, selectedServiceId, staffId, dateStrip[0], dateStrip.length)
      .then((dates) => {
        if (!cancelled) setDatesAnswer({ request: datesRequest, dates: dates ? new Set(dates) : null });
      })
      .catch((err) => {
        if (cancelled) return;
        // Unknown = every day stays selectable.
        setDatesAnswer({ request: datesRequest, dates: null });
        if (err instanceof BookingRateLimitedError) setError(booking.rateLimitedError);
      });
    return () => {
      cancelled = true;
    };
  }, [datesRequest, workspaceSlug, selectedServiceId, selectedStaffId, dateStrip, booking.rateLimitedError]);

  const slotsRequest = step === "time" && selectedServiceId ? `${stepVisit}|${selectedServiceId}|${selectedStaffId}|${selectedDate}` : null;
  const [slotsAnswer, setSlotsAnswer] = useState<{ request: string; slots: AvailableSlot[] } | null>(null);
  const slotsLoading = slotsRequest !== null && slotsAnswer?.request !== slotsRequest;
  const slots = slotsAnswer && slotsAnswer.request === slotsRequest ? slotsAnswer.slots : [];

  useEffect(() => {
    if (!slotsRequest || !selectedServiceId) return;
    let cancelled = false;
    const staffId = selectedStaffId === "any" ? null : selectedStaffId;
    getPublicBookingService(workspaceSlug)
      .getAvailableSlots(workspaceSlug, selectedServiceId, staffId, selectedDate)
      // "Any specialist" yields one slot per free specialist per time — the
      // visitor sees each time once; the assignee is resolved at booking.
      .then((all) => {
        if (!cancelled) setSlotsAnswer({ request: slotsRequest, slots: uniqueSlotTimes(all) });
      })
      .catch((err) => {
        if (cancelled) return;
        setSlotsAnswer({ request: slotsRequest, slots: [] });
        if (err instanceof BookingRateLimitedError) setError(booking.rateLimitedError);
      });
    return () => {
      cancelled = true;
    };
  }, [slotsRequest, workspaceSlug, selectedServiceId, selectedStaffId, selectedDate, booking.rateLimitedError]);

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
    setStepVisit((n) => n + 1);
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
        locale,
      });
      setResult(booked);
      goTo("confirmation");
    } catch (err) {
      if (!(err instanceof BookingUnavailableError)) {
         
        console.error("Public booking failed", err);
      }
      setError(err instanceof BookingRateLimitedError ? booking.rateLimitedError : booking.slotTakenError);
      setStep("time");
      setStepVisit((n) => n + 1); // reload the times: the chosen one was just taken
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
            {backToBusinessesHref ? (
              <Link href={backToBusinessesHref} className={styles.stepBack}>
                <Icon name="arrowLeft" size={16} strokeWidth={1.8} />
                {client.allBusinesses}
              </Link>
            ) : null}
            {profile ? <BusinessAbout profile={profile} /> : null}
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
                    {service.description ? <span className={styles.optionDescription}>{service.description}</span> : null}
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
              {booking.back}
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
                    s.active !== false &&
                    (!selectedService?.allowedStaffIds.length ||
                    selectedService.allowedStaffIds.includes(s.id)),
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
                      <span className={styles.optionTitle}>{staffLabel(staff.name)}</span>
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
              {booking.back}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepDate}</h1>
            {error && <p className={styles.errorText}>{error}</p>}
            {datesLoading ? <p className={styles.fieldHint}>{booking.datesLoading}</p> : null}
            {!datesLoading && availableDates && availableDates.size === 0 ? (
              <div className={styles.empty}>
                <span className={styles.emptyTitle}>{booking.noDatesTitle}</span>
                {booking.noDatesDescription}
              </div>
            ) : null}
            <div className={styles.dateStrip}>
              {dateStrip.map((iso) => {
                const date = new Date(iso + "T00:00:00");
                const unavailable = datesLoading || (availableDates !== null && !availableDates.has(iso));
                return (
                  <button
                    key={iso}
                    type="button"
                    disabled={unavailable}
                    title={unavailable && !datesLoading ? booking.dateUnavailable : undefined}
                    className={`${styles.dateChip} ${selectedDate === iso ? styles.dateChipActive : ""} ${unavailable ? styles.dateChipDisabled : ""}`}
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
              {booking.back}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepTime}</h1>
            {zoneNote && <p className={styles.fieldHint}>{zoneNote}</p>}
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
              {booking.back}
            </button>
            <h1 className={styles.stepTitle}>{booking.stepDetails}</h1>
            <p className={styles.detailsHelper}>{booking.detailsHelper}</p>
            {zoneNote && <p className={styles.fieldHint}>{zoneNote}</p>}

            <div className={styles.summaryCard} style={{ borderLeftColor: branding.primaryColor }}>
              <span className={styles.summaryLine}>{getServiceLabel(selectedService, locale)}</span>
              <span className={styles.summaryLineMuted}>
                {formatDate(new Date(selectedDate + "T00:00:00"), locale, { dateStyle: "medium" })} ·{" "}
                {selectedSlot.time} ·{" "}
                {selectedStaffId === "any"
                  ? booking.anyStaff
                  : staffLabel(selectedSlot.staffName)}
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
                <textarea suppressHydrationWarning
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
                <dd>{staffLabel(result.staffName)}</dd>
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
            {calendarConnected && result.claim === "linked" ? (
              // Linked to the account the client's calendar subscribes to: it appears there by itself.
              <p className={styles.calendarAutoNote} role="status">
                <Icon name="check" size={16} /> {booking.calendarAutoNote}
              </p>
            ) : (
              <AddToCalendar
                labels={{ title: booking.addToCalendarTitle, google: booking.addToCalendarGoogle, appleOutlook: booking.addToCalendarFile }}
                event={(() => {
                  // The booked time is the BUSINESS wall clock; demo workspaces have no zone (browser-local).
                  const start = timezone ? wallToInstant(result.date, result.time, timezone) : new Date(`${result.date}T${result.time}:00`);
                  return {
                    uid: `appointment-${result.appointmentId}@serviceos`,
                    start,
                    end: new Date(start.getTime() + selectedService.durationMinutes * 60_000),
                    summary: `${getServiceLabel(selectedService, locale)} · ${branding.businessName}`,
                    description: staffLabel(result.staffName),
                    status: result.status === "confirmed" ? "CONFIRMED" : "TENTATIVE",
                  };
                })()}
              />
            )}
            <Button
              fullWidth
              onClick={() => {
                setStep("service");
                setStepVisit((n) => n + 1);
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
            {result.claim === "linked" ? (
              <>
                <p className={styles.claimNote} role="status">
                  {booking.claimLinkedNote}
                </p>
                <Link href="/client/bookings" className={styles.claimPrimary}>
                  {booking.myBookingsLink}
                </Link>
              </>
            ) : result.claim === "pending" ? (
              <div className={styles.claimBox}>
                <p className={styles.claimNote}>{booking.claimPendingBody}</p>
                <Link href={clientAuthHref("signup")} className={styles.claimPrimary}>
                  {client.createAccountCta}
                </Link>
                <Link href={clientAuthHref("login")} className={styles.claimSecondary}>
                  {client.loginLink}
                </Link>
              </div>
            ) : identity ? (
              // Demo / no account linkage: no promise that the booking shows up in a real account.
              <Link href="/client/bookings?demo=1" className={styles.createAccountLink}>
                {booking.myBookingsLink}
              </Link>
            ) : null}
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

/** Customer-facing facts the owner chose to publish; empty fields are simply not shown. */
function BusinessAbout({ profile }: { profile: PublicProfile }) {
  const address = [profile.addressLine1, [profile.postalCode, profile.city].filter(Boolean).join(" "), profile.country]
    .filter(Boolean)
    .join(", ");
  const lines = [
    profile.phone ? <a key="p" href={`tel:${profile.phone.replace(/[^0-9+]/g, "")}`}>{profile.phone}</a> : null,
    profile.email ? <a key="e" href={`mailto:${profile.email}`}>{profile.email}</a> : null,
    profile.website ? (
      <a key="w" href={profile.website} target="_blank" rel="noopener noreferrer">
        {profile.website.replace(/^https?:\/\//i, "")}
      </a>
    ) : null,
    address ? <span key="a">{address}</span> : null,
  ].filter(Boolean);
  if (!profile.description && lines.length === 0) return null;
  return (
    <div className={styles.about}>
      {profile.description ? <p className={styles.aboutText}>{profile.description}</p> : null}
      {lines.length > 0 ? <p className={styles.aboutLines}>{lines}</p> : null}
    </div>
  );
}
