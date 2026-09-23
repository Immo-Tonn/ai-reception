"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, Icon } from "@/components/ui";
import {
  listBookableServicesAction,
  listBookableStaffAction,
  getAvailabilityAction,
  createPublicBookingAction,
} from "@/server/actions/booking.actions";
import type { AvailableSlot } from "@/server/services/availability.service";
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
  branding,
  chromeless = false,
  headerActions,
}: {
  workspaceSlug: string;
  locale: Locale;
  booking: Messages["booking"];
  branding: WorkspaceBranding;
  chromeless?: boolean;
  headerActions?: ReactNode;
}) {
  const [step, setStep] = useState<Step>("service");
  const [services, setServices] = useState<ServiceDefinition[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null | "any">("any");
  const [selectedDate, setSelectedDate] = useState(localIsoDate(new Date()));
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateStrip = buildDateStrip();
  const selectedService = services.find((s) => s.id === selectedServiceId) ?? null;

  useEffect(() => {
    listBookableServicesAction(workspaceSlug).then(setServices);
    listBookableStaffAction(workspaceSlug).then(setStaffList);
  }, [workspaceSlug]);

  useEffect(() => {
    if (step !== "time" || !selectedServiceId) return;
    setSlotsLoading(true);
    const staffId = selectedStaffId === "any" ? null : selectedStaffId;
    getAvailabilityAction(workspaceSlug, selectedServiceId, staffId, selectedDate)
      .then(setSlots)
      .finally(() => setSlotsLoading(false));
  }, [step, workspaceSlug, selectedServiceId, selectedStaffId, selectedDate]);

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
    setSubmitting(true);
    setError(null);
    try {
      await createPublicBookingAction(workspaceSlug, {
        serviceId: selectedService.id,
        staffId: selectedStaffId === "any" ? null : selectedStaffId,
        date: selectedDate,
        time: selectedSlot.time,
        client: { name, email, phone, notes },
      });
      goTo("confirmation");
    } catch {
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
          <span className={styles.businessName}>{branding.businessName}</span>
          {headerActions && <span className={styles.headerRight}>{headerActions}</span>}
        </header>
      )}

      <div className={styles.progressTrack}>
        <div
          className={styles.progressFill}
          style={{ width: `${progress}%`, background: branding.primaryColor }}
        />
      </div>

      <div className={styles.content}>
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
                    <span className={styles.optionTitle}>{service.name}</span>
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
                      <span className={styles.optionTitle}>{staff.name}</span>
                    </span>
                  </button>
                ))}
            </div>
          </>
        )}

        {step === "date" && (
          <>
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
            <h1 className={styles.stepTitle}>{booking.stepDetails}</h1>
            <div className={styles.summaryCard}>
              <span className={styles.summaryLine}>{selectedService.name}</span>
              <span className={styles.summaryLineMuted}>
                {formatDate(new Date(selectedDate + "T00:00:00"), locale, { dateStyle: "medium" })} ·{" "}
                {selectedSlot.time} · {selectedSlot.staffName}
              </span>
            </div>
            {error && <p className={styles.errorText}>{error}</p>}
            <div className={styles.form}>
              <label className={styles.label}>
                {booking.nameLabel}
                <input
                  className={styles.textarea}
                  style={{ minHeight: 48 }}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label className={styles.label}>
                {booking.emailLabel}
                <input
                  className={styles.textarea}
                  style={{ minHeight: 48 }}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className={styles.label}>
                {booking.phoneLabel}
                <input
                  className={styles.textarea}
                  style={{ minHeight: 48 }}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
              <label className={styles.label}>
                {booking.notesLabel}
                <textarea
                  className={styles.textarea}
                  placeholder={booking.notesPlaceholder}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
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
              <span className={styles.summaryLine}>{selectedService.name}</span>
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
                setName("");
                setEmail("");
                setPhone("");
                setNotes("");
              }}
            >
              {booking.bookAnother}
            </Button>
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
            disabled={!name || !email || submitting}
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
